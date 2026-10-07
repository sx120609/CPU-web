package cn.lizmt.cpuweb.schedule

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Message
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import kotlin.coroutines.resume

/**
 * Site-auth report from the Web bridge. `ready == false` means the Pinia
 * cookie probe is still running; it must never be read as a sign-out.
 */
data class NativeAuthState(
    val account: String = "",
    val authenticated: Boolean = false,
    val ready: Boolean = false,
    val canAccessAdmin: Boolean = false,
)

/** What the Web router says about the visible page, for the native top bar. */
data class WebHeaderState(
    val path: String = "/home",
    val title: String = "药大拾间",
    val back: Boolean = false,
    val pageNavigation: Boolean = false,
    val authenticated: Boolean = false,
    val unread: Int = 0,
    val directUnread: Int = 0,
    val contentReady: Boolean = false,
)

data class NativeLoginResponse(
    val ok: Boolean,
    val needCaptcha: Boolean,
    val captchaImage: String,
    val error: String,
    val account: String,
)

/** Hooks the Activity provides: pickers, permissions and external intents. */
interface WebSessionHost {
    fun openExternal(uri: Uri)
    fun chooseFiles(params: WebChromeClient.FileChooserParams, callback: ValueCallback<Array<Uri>?>)
    fun requestWebPermissions(permissions: Array<String>, onResult: (Boolean) -> Unit)
    fun handleApkDownload(url: String): Boolean
}

/**
 * The one shared WebView behind every Web tab, the login surface and the
 * native timetable's data bridge (the Android counterpart of iOS
 * `HybridWebViewStore` and the HarmonyOS `Index` Web component).
 */
@SuppressLint("SetJavaScriptEnabled")
class WebSession(
    private val context: Context,
    private val scope: CoroutineScope,
    private val host: WebSessionHost,
    private val legacyBridge: CpuAndroidBridge,
) {
    /** Replaced after a renderer crash: a WebView whose renderer died must never be reused. */
    var webView by mutableStateOf(WebView(context))
        private set

    var currentPath by mutableStateOf("")
        private set
    var header by mutableStateOf(WebHeaderState())
        private set
    var authState by mutableStateOf(NativeAuthState())
        private set
    var isLoading by mutableStateOf(true)
        private set
    var contentReady by mutableStateOf(false)
        private set
    /** A main-document failure with nothing usable on screen. */
    var failureMessage by mutableStateOf<String?>(null)
        private set
    var webOverlayVisible by mutableStateOf(false)
        private set
    var androidUpdateVisible by mutableStateOf(false)
        private set
    var unreadCount by mutableIntStateOf(0)
        private set
    var directUnreadCount by mutableIntStateOf(0)
        private set
    var bridgeReady by mutableStateOf(false)
        private set

    /** While the native login gate is up only authentication pages may load. */
    var blocksInternalNavigation = false

    var onNavigate: ((String) -> Unit)? = null
    var onRoute: ((String) -> Unit)? = null
    var onAuthStateChanged: ((NativeAuthState) -> Unit)? = null
    var onBridgeReady: (() -> Unit)? = null
    var onSchedulePrefetched: ((String) -> Unit)? = null
    var onBridgeLost: ((String) -> Unit)? = null
    var onAppearanceReported: ((mode: String) -> Unit)? = null
    /** The native appearance choice, pushed to each page once its bridge is ready. */
    var nativeAppearanceMode: (() -> String)? = null

    private val bootstrapScript: String
    private val compatibilityScript: String
    private val documentStartSupported: Boolean
    private val pending = HashMap<String, CancellableContinuation<CallOutcome>>()
    private var callSequence = 0
    private var navigationGeneration = 0
    private var legacyAttached = false
    private var nativeInterfaceAttached = false

    init {
        val assets = context.assets
        bootstrapScript = assets.open("NativeShellBootstrap.js").bufferedReader().use { it.readText() }
            .replace("__CPU_APP_ORIGIN__", AppConfig.origin)
        compatibilityScript = assets.open("NativeWebCompatibility.js").bufferedReader().use { it.readText() }
        documentStartSupported = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
        configure()
    }

    // region Setup

    private fun configure() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG || BuildConfig.WEB_DEBUG)
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.setBackgroundColor(Color.TRANSPARENT)
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        @Suppress("DEPRECATION")
        settings.databaseEnabled = true
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.textZoom = 100
        settings.mediaPlaybackRequiresUserGesture = false
        settings.javaScriptCanOpenWindowsAutomatically = true
        settings.setSupportMultipleWindows(true)
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        val versionName = runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull() ?: BuildConfig.VERSION_NAME
        settings.userAgentString = settings.userAgentString
            .replace(Regex("\\sCPUWebScheduleApp(?:Version)?/\\S+"), "")
            .replace(Regex("\\sCPUTimeNative/\\S+"), "") +
            " " + AppConfig.userAgentSuffix(BuildConfig.VERSION_CODE, versionName)
        // The Web app draws its own dark theme; forced darkening would invert it twice.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
        }

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        val origins = setOf(AppConfig.origin)
        if (documentStartSupported) {
            WebViewCompat.addDocumentStartJavaScript(webView, bootstrapScript, origins)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // Origin-scoped and main-frame checked: an embedded third-party
            // frame can never drive the shell.
            WebViewCompat.addWebMessageListener(webView, "CPUAndroidNativePort", origins) { _, message, sourceOrigin, isMainFrame, _ ->
                if (isMainFrame && AppConfig.isTrusted(sourceOrigin.toString())) message.data?.let(::receive)
            }
        } else {
            nativeInterfaceAttached = true
            webView.addJavascriptInterface(NativeInterface(), "CPUAndroidNative")
        }
        setLegacyBridgeAttached(true)

        webView.webViewClient = ShellClient()
        webView.webChromeClient = ShellChromeClient()
        webView.setDownloadListener { url, _, _, _, _ -> openOutside(Uri.parse(url)) }
    }

    /** The existing `CPUAndroid` bridge (updates, widgets, images) stays first-party only. */
    private fun setLegacyBridgeAttached(attached: Boolean) {
        if (legacyAttached == attached) return
        if (attached) webView.addJavascriptInterface(legacyBridge, "CPUAndroid")
        else webView.removeJavascriptInterface("CPUAndroid")
        if (nativeInterfaceAttached) {
            if (attached) webView.addJavascriptInterface(NativeInterface(), "CPUAndroidNative")
            else webView.removeJavascriptInterface("CPUAndroidNative")
        }
        legacyAttached = attached
    }

    fun start() {
        if (webView.url == null) webView.loadUrl(AppConfig.startUrl)
    }

    // endregion

    // region Messages

    private inner class NativeInterface {
        @android.webkit.JavascriptInterface
        fun post(text: String?) {
            // The fallback interface is visible to every frame; only the
            // first-party main document may drive the shell.
            if (text != null) webView.post { if (AppConfig.isTrusted(webView.url)) receive(text) }
        }
    }

    private fun receive(text: String) {
        val message = runCatching { JSONObject(text) }.getOrNull() ?: return
        when (message.optString("kind")) {
            "resolve" -> pending.remove(message.optString("id"))?.let { continuation ->
                if (continuation.isActive) continuation.resume(CallOutcome.Value(message.optString("value", "null")))
            }
            "post" -> message.optJSONObject("payload")?.let(::handle)
        }
    }

    private fun handle(payload: JSONObject) {
        when (payload.optString("type")) {
            "ready" -> {
                bridgeReady = true
                nativeAppearanceMode?.invoke()?.let(::setAppearanceMode)
                onBridgeReady?.invoke()
            }
            "navigate" -> onNavigate?.invoke(payload.optString("path"))
            "route" -> {
                val path = payload.optString("path")
                currentPath = path
                onRoute?.invoke(path)
            }
            "authChanged" -> {
                val account = payload.optString("account").trim()
                val state = NativeAuthState(
                    account = account,
                    authenticated = payload.optBoolean("authenticated", account.isNotEmpty()),
                    ready = payload.optBoolean("ready", true),
                    canAccessAdmin = payload.optBoolean("canAccessAdmin", false),
                )
                authState = state
                if (state.ready && !state.authenticated) {
                    unreadCount = 0
                    directUnreadCount = 0
                }
                onAuthStateChanged?.invoke(state)
            }
            "notificationsChanged" -> {
                unreadCount = payload.optInt("unreadCount", 0).coerceAtLeast(0)
                directUnreadCount = payload.optInt("directUnreadCount", 0).coerceAtLeast(0)
            }
            // Reports from a page still booting may carry a stale choice; the
            // native mode is pushed on `ready`, later changes come from the page.
            "appearance" -> if (bridgeReady) onAppearanceReported?.invoke(payload.optString("mode", "system"))
            "schedulePrefetched" -> payload.optJSONObject("snapshot")?.let { onSchedulePrefetched?.invoke(it.toString()) }
            "header" -> payload.optJSONObject("state")?.let { state ->
                val next = WebHeaderState(
                    path = state.optString("path", "/home"),
                    title = state.optString("title", "药大拾间"),
                    back = state.optBoolean("back", false),
                    pageNavigation = state.optBoolean("pageNavigation", false),
                    authenticated = state.optBoolean("authenticated", false),
                    unread = state.optInt("unread", 0),
                    directUnread = state.optInt("directUnread", 0),
                    contentReady = state.optBoolean("contentReady", false),
                )
                header = next
                if (next.contentReady) contentReady = true
                if (next.authenticated) {
                    unreadCount = next.unread
                    directUnreadCount = next.directUnread
                }
            }
            "webOverlay" -> webOverlayVisible = payload.optBoolean("visible", false)
            "androidUpdatePrompt" -> androidUpdateVisible = payload.optBoolean("visible", false)
        }
    }

    /** How a page call ended: a value, no bridge in the page yet, or lost to a timeout or navigation. */
    private sealed interface CallOutcome {
        data class Value(val text: String) : CallOutcome
        data object Missing : CallOutcome
        data object Lost : CallOutcome
    }

    /**
     * Run an async function body in the page and wait for its JSON result.
     * Returns null on timeout, navigation or a missing bridge.
     */
    suspend fun call(body: String, args: JSONObject = JSONObject(), timeoutMs: Long = 30_000): String? =
        (invoke(body, args, timeoutMs) as? CallOutcome.Value)?.text

    private suspend fun invoke(body: String, args: JSONObject, timeoutMs: Long): CallOutcome {
        val id = "n${++callSequence}"
        val script = "(function(){var send=window.CPUTimeNative&&window.CPUTimeNative.__resolve;" +
            "if(typeof send!=='function')return 'missing';" +
            "var args=" + args.toString() + ";" +
            "(async function(){try{var value=await (async function(){" + body + "\n})();" +
            "send('" + id + "',JSON.stringify(value===undefined?null:value));}" +
            "catch(error){send('" + id + "',JSON.stringify({__error:String((error&&error.message)||error)}));}})();" +
            "return 'ok';})()"
        val target = webView
        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine { continuation ->
                pending[id] = continuation
                continuation.invokeOnCancellation { pending.remove(id) }
                target.evaluateJavascript(script) { value ->
                    if (value != "\"ok\"") pending.remove(id)?.let { if (it.isActive) it.resume(CallOutcome.Missing) }
                }
            }
        } ?: CallOutcome.Lost
    }

    fun evaluate(script: String) = webView.evaluateJavascript(script, null)

    private fun failPendingCalls() {
        val calls = pending.values.toList()
        pending.clear()
        calls.forEach { if (it.isActive) it.resume(CallOutcome.Lost) }
    }

    // endregion

    // region Navigation

    /** Switch the shared page to a route; tab switches replace, other opens push. */
    fun navigate(path: String, replace: Boolean = true) {
        val url = AppConfig.routeUrl(path) ?: return
        val generation = ++navigationGeneration
        scope.launch {
            if (bridgeReady) {
                val body = "var bridge=window.CPUTimeNative||{};" +
                    "var open=args.replace?(window.CPUAndroidOpenTab||bridge.openWebRoute):(bridge.openWebRoute||window.CPUAndroidOpenTab);" +
                    "if(typeof open!=='function')return false;" +
                    "bridge.nativeNavigationDepth=(bridge.nativeNavigationDepth||0)+1;" +
                    "try{await open(args.path);return true;}finally{bridge.nativeNavigationDepth-=1;}"
                val value = call(body, JSONObject().put("path", path).put("replace", replace), 8_000)
                if (generation != navigationGeneration) return@launch
                if (value == "true") return@launch
            }
            if (generation != navigationGeneration) return@launch
            if (webView.url != url) webView.loadUrl(url)
        }
    }

    /** Close a Web dialog, go back inside the Web router, or report that nothing was handled. */
    suspend fun goBack(root: String): Boolean {
        if (webOverlayVisible || androidUpdateVisible) {
            evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));")
            return true
        }
        val value = call(
            "var back=window.CPUAndroidBack;if(typeof back!=='function')return null;return Boolean(await back(args.root));",
            JSONObject().put("root", root), 4_000,
        )
        return when (value) {
            "true" -> true
            "false" -> false
            else -> if (webView.canGoBack()) { webView.goBack(); true } else false
        }
    }

    fun headerAction(action: String, root: String) {
        scope.launch {
            call(
                "var run=window.CPUAndroidHeaderAction;if(typeof run!=='function')return false;await run(args.action,args.root);return true;",
                JSONObject().put("action", action).put("root", root), 4_000,
            )
        }
    }

    fun refresh() {
        failureMessage = null
        if (webView.url == null) webView.loadUrl(AppConfig.startUrl) else webView.reload()
    }

    fun retry() {
        failureMessage = null
        webView.loadUrl(AppConfig.routeUrl(currentPath.ifEmpty { "/home" }) ?: AppConfig.startUrl)
    }

    // endregion

    // region Bridge calls

    suspend fun loadSchedule(request: ScheduleRequest): String? {
        val body = "var fetchSchedule=window.CPUTimeNativeScheduleFetch;" +
            "if(typeof fetchSchedule!=='function')return {version:1,auth:{authenticated:true},error:'课表桥尚未准备好'};" +
            "return await fetchSchedule(args.semester||undefined,args.week||undefined,Boolean(args.force));"
        val value = call(body, JSONObject().put("semester", request.semester).put("week", request.week).put("force", request.force), 65_000)
            ?: return null
        val parsed = runCatching { JSONObject(value) }.getOrNull()
        val scriptError = parsed?.optString("__error").orEmpty()
        if (scriptError.isNotEmpty()) {
            return JSONObject().put("version", 1).put("auth", JSONObject().put("authenticated", true))
                .put("error", scriptError).toString()
        }
        return value
    }

    fun prioritizeSchedule(semester: String, week: String) {
        val args = JSONObject().put("semester", semester).put("week", week)
        evaluate("(function(a){try{window.CPUTimeNativeSchedulePrioritize&&window.CPUTimeNativeSchedulePrioritize(a.semester,a.week);}catch(_){}})($args);")
    }

    suspend fun editCourse(payload: JSONObject): String? = call(
        "var edit=window.CPUAndroidEditor;if(typeof edit!=='function')return {error:'课程编辑器尚未就绪，请重试'};return await edit(args.payload);",
        JSONObject().put("payload", payload), 60_000,
    )

    /** The display priorities saved with the schedule edits of a semester; null when they could not be read. */
    suspend fun loadSchedulePriorities(semester: String): Map<String, Int>? {
        val raw = call(
            "var edit=window.CPUAndroidEditor;if(typeof edit!=='function')return {error:'missing'};" +
                "return await edit({action:'priority',semester:args.semester});",
            JSONObject().put("semester", semester), 40_000,
        ) ?: return null
        val priority = runCatching { JSONObject(raw) }.getOrNull()?.optJSONObject("priority") ?: return null
        return priority.keys().asSequence().associateWith { priority.optInt(it, 0) }.filter { it.value > 0 }
    }

    /** One share-code request (`CPUAndroidShares`): the reply is `{ data }` or `{ error, status }`. */
    suspend fun shares(payload: JSONObject): String? = call(
        "var run=window.CPUAndroidShares;if(typeof run!=='function')return {error:'共享课表尚未就绪，请稍后重试',status:0};" +
            "return await run(args.payload);",
        JSONObject().put("payload", payload), 45_000,
    )

    suspend fun refreshAuthCapability(): NativeAuthState? {
        val value = call(
            "for(var attempt=0;attempt<20;attempt+=1){var refresh=window.CPUTimeNative&&window.CPUTimeNative.refreshAuth;" +
                "if(typeof refresh==='function')return await Promise.race([refresh(),new Promise(function(r){setTimeout(function(){r(null);},6000);})]);" +
                "await new Promise(function(r){setTimeout(r,100);});}return false;",
            timeoutMs = 10_000,
        ) ?: return null
        val payload = runCatching { JSONObject(value) }.getOrNull() ?: return null
        val account = payload.optString("account").trim()
        val state = NativeAuthState(
            account = account,
            authenticated = payload.optBoolean("authenticated", account.isNotEmpty()),
            ready = payload.optBoolean("ready", true),
            canAccessAdmin = payload.optBoolean("canAccessAdmin", false),
        )
        authState = state
        return state
    }

    suspend fun restoreAcademicSession() {
        call(
            "var restore=window.CPUTimeNative&&window.CPUTimeNative.restoreAcademicSession;" +
                "if(typeof restore!=='function')return false;" +
                "return await Promise.race([restore(),new Promise(function(r){setTimeout(function(){r(false);},8000);})]);",
            timeoutMs = 10_000,
        )
    }

    /** Wait for the Web auth store's first complete report. */
    suspend fun waitForAuthState(timeoutMs: Long): NativeAuthState? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (authState.ready) return authState
            delay(80)
        }
        return authState.takeIf { it.ready }
    }

    fun hasSessionCookie(): Boolean = ScheduleArchive.currentSessionFingerprint().isNotEmpty()

    fun setAppearanceMode(mode: String) {
        val args = JSONObject().put("mode", mode)
        evaluate(
            "(function(a){var mode=a.mode;try{window.__cpuSetAppearanceMode&&window.__cpuSetAppearanceMode(mode);}catch(_){}" +
                "try{localStorage.setItem('cpu-appearance-mode-v1',mode);}catch(_){}" +
                "var dark=mode==='dark'||(mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);" +
                "var root=document.documentElement;root.dataset.appearanceMode=mode;root.dataset.theme=dark?'dark':'light';" +
                "root.classList.toggle('dark',dark);root.style.colorScheme=dark?'dark':'light';})($args);",
        )
    }

    /** Ask the Web auth store to create the same SSO challenge the browser login page uses. */
    suspend fun nativeLoginBegin(): NativeLoginResponse = loginCall("nativeLoginBegin", JSONObject(), "", retriesAfterLoss = true)

    suspend fun nativeSsoLogin(username: String, password: String, captcha: String, remember: Boolean) =
        loginCall(
            "nativeSsoLogin",
            JSONObject().put("username", username).put("password", password).put("captcha", captcha).put("remember", remember),
            "args.username,args.password,args.captcha,args.remember",
            retriesAfterLoss = false,
        )

    suspend fun nativeAccountLogin(username: String, password: String) =
        loginCall("nativeAccountLogin", JSONObject().put("username", username).put("password", password), "args.username,args.password", retriesAfterLoss = false)

    /**
     * Retry only while the page's login bridge is still booting. A call lost to
     * a timeout or a page load may already have reached the server, so a
     * credential submit is never replayed (its captcha is single-use anyway).
     */
    private suspend fun loginCall(method: String, args: JSONObject, parameters: String, retriesAfterLoss: Boolean): NativeLoginResponse {
        val starting = "登录服务正在启动，请稍候再试。"
        val body = "var bridge=window.CPUTimeNative;if(!bridge||typeof bridge.$method!=='function')return {ok:false,error:'$starting'};" +
            "try{return await bridge.$method($parameters);}catch(_){return {ok:false,error:'登录暂时失败，请稍后再试。'};}"
        repeat(80) { attempt ->
            // A school SSO login may take up to 95 s through its redirects (Web auth store).
            val outcome = invoke(body, args, if (retriesAfterLoss) 45_000 else 100_000)
            if (outcome == CallOutcome.Lost && !retriesAfterLoss) {
                return NativeLoginResponse(false, false, "", "登录请求已中断，请确认登录状态后再试。", "")
            }
            val payload = (outcome as? CallOutcome.Value)?.let { runCatching { JSONObject(it.text) }.getOrNull() }
            if (payload != null && payload.optString("error") != starting) {
                bridgeReady = true
                return NativeLoginResponse(
                    ok = payload.optBoolean("ok", false),
                    needCaptcha = payload.optBoolean("needCaptcha", false),
                    captchaImage = payload.optString("captchaImage", ""),
                    error = payload.optString("error", if (payload.optBoolean("ok")) "" else "登录暂时失败，请稍后再试。"),
                    account = payload.optString("account", ""),
                )
            }
            if (attempt < 79) delay(125)
        }
        return NativeLoginResponse(false, false, "", failureMessage ?: "登录服务启动超时，请稍后重试。", "")
    }

    // endregion

    // region Clients

    private fun openOutside(uri: Uri) {
        val url = uri.toString()
        if (isApkDownload(uri) && host.handleApkDownload(url)) return
        host.openExternal(uri)
    }

    private fun isApkDownload(uri: Uri): Boolean {
        val path = uri.path ?: return false
        return path.endsWith(".apk", ignoreCase = true) || path == "/api/site/downloads/android-app"
    }

    private fun isDownloadLink(uri: Uri): Boolean =
        isApkDownload(uri) || uri.path?.startsWith("/api/site/downloads/") == true

    private inner class ShellClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            decide(request.url, request.isForMainFrame, request.hasGesture())

        private fun decide(uri: Uri, mainFrame: Boolean, gesture: Boolean): Boolean {
            val scheme = uri.scheme?.lowercase() ?: return true
            if (scheme == "http" || scheme == "https") {
                val url = uri.toString()
                if (isDownloadLink(uri)) {
                    openOutside(uri)
                    return true
                }
                if (AppConfig.isTrusted(url)) {
                    val path = AppConfig.pathOf(url).orEmpty()
                    if (blocksInternalNavigation && mainFrame && !ShellTab.isAuthPath(path)) return true
                    if (mainFrame && ShellTab.isSchedulePath(path)) {
                        if (gesture) onNavigate?.invoke(path)
                        return true
                    }
                    setLegacyBridgeAttached(true)
                    return false
                }
                if (AppConfig.isPayment(url)) {
                    setLegacyBridgeAttached(false)
                    return false
                }
                // Embedded third-party frames (maps, video) load in place.
                if (!mainFrame) return false
                openOutside(uri)
                return true
            }
            if (!mainFrame) return true
            if (scheme == "tel" || scheme == "mailto" || scheme == "sms") {
                host.openExternal(uri)
            } else if (scheme in PAYMENT_APP_SCHEMES && (gesture || AppConfig.isPayment(webView.url))) {
                // The cashier hands over to the Alipay / WeChat apps.
                host.openExternal(uri)
            }
            return true
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            isLoading = true
            bridgeReady = false
            webOverlayVisible = false
            androidUpdateVisible = false
            // Cancel the store's request before its call resolves as lost, so
            // a reload never surfaces as a request timeout.
            onBridgeLost?.invoke("")
            failPendingCalls()
            setLegacyBridgeAttached(AppConfig.isTrusted(url))
        }

        override fun onPageFinished(view: WebView, url: String?) {
            isLoading = false
            CookieManager.getInstance().flush()
            if (!AppConfig.isTrusted(url)) return
            failureMessage = null
            AppConfig.pathOf(url)?.let { path ->
                currentPath = path
                onRoute?.invoke(path)
            }
            // Older WebView builds cannot inject at document start; the
            // bootstrap is idempotent, so running it here is safe everywhere.
            if (!documentStartSupported) view.evaluateJavascript(bootstrapScript, null)
            view.evaluateJavascript(compatibilityScript, null)
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            isLoading = false
            val message = "页面暂时无法打开，请检查网络后重试。"
            if (!contentReady) failureMessage = message
            onBridgeLost?.invoke("网络连接失败，请重新打开页面")
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (!request.isForMainFrame || response.statusCode < 500) return
            if (!AppConfig.isTrusted(request.url.toString())) return
            isLoading = false
            failureMessage = "服务暂时不可用，请检查网络连接或切换流量后重试。"
        }

        override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
            // Returning true keeps the app alive, but this WebView is now
            // unusable: replace it and reopen the page the user was on.
            if (view === webView) replaceAfterRendererLoss(view) else destroyDetached(view)
            return true
        }
    }

    private inner class ShellChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            filePathCallback: ValueCallback<Array<Uri>?>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            host.chooseFiles(fileChooserParams, filePathCallback)
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            if (!AppConfig.isTrusted(request.origin.toString())) {
                request.deny()
                return
            }
            val permissions = mutableListOf<String>()
            if (request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) permissions += android.Manifest.permission.CAMERA
            if (request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) permissions += android.Manifest.permission.RECORD_AUDIO
            if (permissions.isEmpty()) {
                request.deny()
                return
            }
            host.requestWebPermissions(permissions.toTypedArray()) { granted ->
                if (granted) request.grant(request.resources) else request.deny()
            }
        }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val popup = WebView(view.context)
            popup.webViewClient = object : WebViewClient() {
                private var opened = false
                override fun shouldOverrideUrlLoading(popupView: WebView, request: WebResourceRequest): Boolean {
                    route(popupView, request.url)
                    return true
                }

                override fun onPageStarted(popupView: WebView, url: String?, favicon: Bitmap?) {
                    if (url != null && url != "about:blank") route(popupView, Uri.parse(url))
                }

                private fun route(popupView: WebView, uri: Uri) {
                    if (opened) return
                    opened = true
                    val url = uri.toString()
                    if (isDownloadLink(uri)) {
                        openOutside(uri)
                    } else if (AppConfig.isTrusted(url)) {
                        val path = AppConfig.pathOf(url).orEmpty()
                        if (!blocksInternalNavigation || ShellTab.isAuthPath(path)) {
                            if (ShellTab.isSchedulePath(path)) onNavigate?.invoke(path) else navigate(path, replace = false)
                        }
                    } else {
                        openOutside(uri)
                    }
                    popupView.post { destroyDetached(popupView) }
                }
            }
            // A popup that never navigates must not linger.
            popup.postDelayed({ if (popup.url == null || popup.url == "about:blank") destroyDetached(popup) }, 15_000)
            val transport = resultMsg.obj as WebView.WebViewTransport
            transport.webView = popup
            resultMsg.sendToTarget()
            return true
        }
    }

    // endregion

    private fun replaceAfterRendererLoss(dead: WebView) {
        bridgeReady = false
        webOverlayVisible = false
        androidUpdateVisible = false
        onBridgeLost?.invoke("")
        failPendingCalls()
        val url = AppConfig.routeUrl(currentPath.ifEmpty { "/home" }) ?: AppConfig.startUrl
        legacyAttached = false
        nativeInterfaceAttached = false
        webView = WebView(context)
        configure()
        destroyDetached(dead)
        webView.loadUrl(url)
    }

    private fun destroyDetached(view: WebView) {
        (view.parent as? ViewGroup)?.removeView(view)
        runCatching { view.destroy() }
    }

    fun destroy() {
        failPendingCalls()
        webView.destroy()
    }
}

private val PAYMENT_APP_SCHEMES = setOf("alipays", "alipay", "weixin", "intent")
