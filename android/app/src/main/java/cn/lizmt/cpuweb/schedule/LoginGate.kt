package cn.lizmt.cpuweb.schedule

import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.School
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Numbers
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The native login surface (ported from iOS `LoginGateView`). The shared
 * WebView stays mounted underneath: the Web auth store performs the SSO
 * handshake and sets the HttpOnly session cookie, so this screen never sees
 * school cookies and never stores the password.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LoginGate(activity: MainActivity) {
    val web = activity.web
    val scope = rememberCoroutineScope()
    var accountUnlocked by remember { mutableStateOf(false) }
    var schoolMode by remember { mutableStateOf(true) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var passwordVisible by remember { mutableStateOf(false) }
    var captcha by remember { mutableStateOf("") }
    var captchaImage by remember { mutableStateOf("") }
    var needCaptcha by remember { mutableStateOf(false) }
    var remember by remember { mutableStateOf(true) }
    var privacyAccepted by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var preparing by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf("") }
    var statusMessage by remember { mutableStateOf("") }
    var prepareRevision by remember { mutableIntStateOf(0) }
    // 多学校：可选学校和当前学校（网页还是旧版时 schools 为空，不显示学校选择）。
    var schools by remember { mutableStateOf(emptyList<LoginSchool>()) }
    var school by remember { mutableStateOf<LoginSchool?>(null) }
    var schoolMenu by remember { mutableStateOf(false) }
    var switchingSchool by remember { mutableStateOf(false) }
    // 学校要求新设备扫码二次验证时，表单换成二维码。
    var mfaQr by remember { mutableStateOf("") }
    var mfaGuide by remember { mutableStateOf<MfaGuide?>(null) }
    var mfaState by remember { mutableStateOf("") }
    var mfaRevision by remember { mutableIntStateOf(0) }
    val brandName = school?.brandName ?: AppConfig.APP_NAME

    LaunchedEffect(Unit) {
        val list = web.nativeLoginSchools() ?: return@LaunchedEffect
        schools = list.schools
        if (school == null) school = list.current
        if (list.current?.ssoLogin == false) {
            accountUnlocked = true
            schoolMode = false
        }
    }

    fun chooseSchool(target: LoginSchool) {
        schoolMenu = false
        if (target.id == school?.id || switchingSchool || loading) return
        switchingSchool = true
        preparing = true
        errorMessage = ""
        statusMessage = ""
        captcha = ""
        scope.launch {
            val response = web.nativeChooseSchool(target.id)
            school = response.school ?: target
            if (school?.ssoLogin == false) {
                accountUnlocked = true
                schoolMode = false
            } else {
                needCaptcha = response.needCaptcha
                captchaImage = response.captchaImage
                if (!response.ok && response.error.isNotEmpty()) errorMessage = response.error
            }
            preparing = false
            switchingSchool = false
        }
    }

    fun leaveMfa() {
        mfaGuide = null
        mfaQr = ""
        mfaState = ""
        errorMessage = ""
        scope.launch { web.nativeMfaCancel() }
        prepareRevision += 1
    }

    // 轮询扫码结果：done 时网页已经登录，外壳收到登录状态后自己收起登录页。
    LaunchedEffect(mfaRevision) {
        if (mfaQr.isEmpty()) return@LaunchedEffect
        while (mfaQr.isNotEmpty()) {
            delay(if (mfaState == "retry") 4_000 else 2_000)
            if (mfaState == "expired" || mfaState == "done") return@LaunchedEffect
            val response = web.nativeMfaPoll()
            if (mfaQr.isEmpty()) return@LaunchedEffect
            when (response.status) {
                "done" -> {
                    mfaState = "done"
                    password = ""
                    captcha = ""
                    statusMessage = "验证通过，正在进入$brandName…"
                    return@LaunchedEffect
                }
                "waiting", "scanned", "expired", "retry" -> {
                    mfaState = response.status
                    errorMessage = if (response.status == "retry") response.error else ""
                }
                else -> {
                    mfaQr = ""
                    mfaState = ""
                    errorMessage = response.error.ifBlank { "验证失败，请重新登录" }
                    prepareRevision += 1
                    return@LaunchedEffect
                }
            }
        }
    }

    fun refreshMfa() {
        scope.launch {
            val response = web.nativeMfaRefresh()
            if (response.ok && response.mfaQr.isNotEmpty()) {
                mfaQr = response.mfaQr
                mfaState = "waiting"
                errorMessage = ""
                mfaRevision += 1
            } else {
                errorMessage = response.error.ifBlank { "二维码刷新失败，请重新登录" }
            }
        }
    }

    LaunchedEffect(schoolMode, prepareRevision) {
        errorMessage = ""
        statusMessage = ""
        if (!schoolMode) {
            preparing = false
            return@LaunchedEffect
        }
        preparing = true
        val response = web.nativeLoginBegin()
        if (!schoolMode) return@LaunchedEffect
        needCaptcha = response.needCaptcha
        captchaImage = response.captchaImage
        if (!response.ok && response.error.isNotEmpty()) errorMessage = response.error
        preparing = false
    }

    fun submit() {
        if (loading) return
        val trimmed = username.trim()
        errorMessage = when {
            trimmed.isEmpty() -> if (schoolMode) "请输入学号或工号" else "请输入用户名"
            password.isEmpty() -> "请输入密码"
            schoolMode && needCaptcha && captcha.isBlank() -> "请输入验证码"
            !privacyAccepted -> "请先阅读并同意隐私政策和用户协议"
            else -> ""
        }
        if (errorMessage.isNotEmpty()) return
        statusMessage = ""
        loading = true
        val submittedSchool = schoolMode
        scope.launch {
            val response = if (submittedSchool) web.nativeSsoLogin(trimmed, password, captcha.trim(), remember)
            else web.nativeAccountLogin(trimmed, password)
            if (submittedSchool != schoolMode) return@launch
            loading = false
            if (response.ok) {
                password = ""
                captcha = ""
                statusMessage = "登录成功，正在进入$brandName…"
            } else if (response.needMfa && response.mfaQr.isNotEmpty()) {
                errorMessage = ""
                mfaGuide = response.mfaGuide
                mfaQr = response.mfaQr
                mfaState = "waiting"
                mfaRevision += 1
            } else {
                needCaptcha = response.needCaptcha
                if (response.captchaImage.isNotEmpty()) captchaImage = response.captchaImage
                errorMessage = response.error
            }
        }
    }

    Box(
        Modifier.fillMaxSize().consumesTouches().background(MaterialTheme.colorScheme.background).statusBarsPadding()
            .windowInsetsPadding(WindowInsets.ime.union(WindowInsets.navigationBars)),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            Modifier.widthIn(max = 430.dp).fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 28.dp),
        ) {
            Image(
                painterResource(R.drawable.app_logo), contentDescription = brandName,
                modifier = Modifier.size(58.dp).clip(RoundedCornerShape(17.dp)).combinedClickable(
                    onClick = {},
                    onLongClick = { accountUnlocked = true },
                ),
            )
            Spacer(Modifier.height(16.dp))
            Text("欢迎回来", fontSize = 32.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(7.dp))
            Text("登录$brandName，继续查看你的校园信息", style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(28.dp))

            if (mfaQr.isNotEmpty()) {
                val appName = mfaGuide?.appName.orEmpty()
                MfaPanel(
                    qr = mfaQr,
                    state = mfaState,
                    guide = mfaGuide,
                    onSave = {
                        val saved = activity.saveImageData(mfaQr, "统一认证二维码.png")
                        val opened = saved && activity.openApp(mfaGuide?.androidPackage.orEmpty())
                        if (saved && !opened && appName.isNotEmpty()) activity.toast("已保存到相册，请在$appName「扫一扫」里从相册选择这张图")
                    },
                    onRefresh = ::refreshMfa,
                    onCancel = ::leaveMfa,
                )
                Messages(errorMessage, statusMessage)
                return@Column
            }

            if (schools.size > 1) {
                Box {
                    OutlinedButton(
                        onClick = { schoolMenu = true }, enabled = !loading && !switchingSchool,
                        shape = RoundedCornerShape(13.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                    ) {
                        Icon(Icons.Rounded.School, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(10.dp))
                        Text(school?.name ?: "选择学校", modifier = Modifier.weight(1f), fontWeight = FontWeight.Medium)
                        if (switchingSchool) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Rounded.ExpandMore, contentDescription = "切换学校")
                    }
                    DropdownMenu(expanded = schoolMenu, onDismissRequest = { schoolMenu = false }) {
                        schools.forEach { item ->
                            val selected = item.id == school?.id
                            DropdownMenuItem(
                                text = { Text(item.name, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal) },
                                trailingIcon = {
                                    if (selected) Icon(Icons.Rounded.CheckCircle, contentDescription = "当前学校", tint = MaterialTheme.colorScheme.primary)
                                },
                                onClick = { chooseSchool(item) },
                            )
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
            }

            if (accountUnlocked && school?.ssoLogin != false) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    SegmentedButton(selected = schoolMode, onClick = { schoolMode = true },
                        shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("统一认证") }
                    SegmentedButton(selected = !schoolMode, onClick = { schoolMode = false },
                        shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("站内账号") }
                }
                Spacer(Modifier.height(20.dp))
            }

            OutlinedTextField(
                value = username, onValueChange = { username = it }, enabled = !loading, singleLine = true,
                label = { Text(if (schoolMode) "学号 / 工号" else "用户名") },
                leadingIcon = { Icon(Icons.Rounded.Person, contentDescription = null) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
                shape = RoundedCornerShape(13.dp), modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = password, onValueChange = { password = it }, enabled = !loading, singleLine = true,
                label = { Text("密码") },
                leadingIcon = { Icon(Icons.Rounded.Lock, contentDescription = null) },
                trailingIcon = {
                    IconButton(onClick = { passwordVisible = !passwordVisible }) {
                        Icon(if (passwordVisible) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                            contentDescription = if (passwordVisible) "隐藏密码" else "显示密码")
                    }
                },
                visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                shape = RoundedCornerShape(13.dp), modifier = Modifier.fillMaxWidth(),
            )
            if (schoolMode && needCaptcha) {
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = captcha, onValueChange = { captcha = it }, enabled = !loading, singleLine = true,
                        label = { Text("验证码") },
                        leadingIcon = { Icon(Icons.Rounded.Numbers, contentDescription = null) },
                        shape = RoundedCornerShape(13.dp), modifier = Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(10.dp))
                    CaptchaImage(captchaImage, Modifier.width(112.dp).height(52.dp).clip(RoundedCornerShape(9.dp))
                        .clickable(enabled = !loading) { prepareRevision += 1 })
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("保持登录状态", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f))
                Switch(checked = remember, onCheckedChange = { remember = it })
            }
            Row(verticalAlignment = Alignment.Top) {
                Checkbox(checked = privacyAccepted, onCheckedChange = { privacyAccepted = it })
                Column(Modifier.padding(top = 12.dp)) {
                    Row {
                        Text("我已阅读并同意 ", style = MaterialTheme.typography.bodySmall)
                        PolicyLink("《隐私政策》") { activity.openExternal(Uri.parse(AppConfig.origin + "/privacy.html")) }
                        Text(" 和 ", style = MaterialTheme.typography.bodySmall)
                        PolicyLink("《用户协议》") { activity.openExternal(Uri.parse(AppConfig.origin + "/terms.html")) }
                    }
                    Spacer(Modifier.height(4.dp))
                    Text("登录后，应用会根据你的授权同步课表和校园服务数据。", style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.height(18.dp))
            Button(
                onClick = ::submit, enabled = !loading && !preparing && privacyAccepted,
                shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp),
            ) {
                if (loading) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    Spacer(Modifier.width(8.dp))
                }
                Text(if (preparing) "准备登录…" else if (schoolMode) "登录并继续" else "登录", fontWeight = FontWeight.SemiBold)
            }
            Messages(errorMessage, statusMessage)
        }
    }
}

@Composable
private fun Messages(errorMessage: String, statusMessage: String) {
    if (errorMessage.isNotBlank()) {
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(errorMessage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
    }
    if (statusMessage.isNotEmpty()) {
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(statusMessage, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
    }
}

/**
 * 学校统一认证的扫码二次验证（有的学校新设备第一次登录时要求）。用哪个 App 扫由学校给（[guide]）；
 * 用户手里多半就是这台手机，所以给「保存二维码并打开 xx」：在那个 App 的「扫一扫 → 相册」里识别。
 */
@Composable
private fun MfaPanel(qr: String, state: String, guide: MfaGuide?, onSave: () -> Unit, onRefresh: () -> Unit, onCancel: () -> Unit) {
    val appName = guide?.appName.orEmpty()
    val scanner = appName.ifEmpty { "手机" }
    Text("扫码验证", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(6.dp))
    Text(
        guide?.hint?.takeIf { it.isNotEmpty() }
            ?: "学校统一认证要求这台设备先验证一次：用${scanner}扫描下面的二维码，并在手机上确认。验证后这台设备会被记住。",
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(16.dp))
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(220.dp).clip(RoundedCornerShape(14.dp)).background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            CaptchaImage(qr, Modifier.size(200.dp), ContentScale.Fit, "学校统一认证二维码")
            val overlay = when (state) {
                "scanned" -> "已扫描，请在手机上确认"
                "expired" -> "二维码已失效，点「换一张」"
                "done" -> "验证通过，正在登录…"
                else -> ""
            }
            if (overlay.isNotEmpty()) {
                Box(
                    Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface.copy(alpha = 0.92f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(overlay, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center, modifier = Modifier.padding(16.dp))
                }
            }
        }
    }
    Spacer(Modifier.height(16.dp))
    Button(
        onClick = onSave, enabled = state != "done" && state != "expired",
        shape = RoundedCornerShape(14.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp),
    ) {
        val canOpen = appName.isNotEmpty() && guide?.androidPackage.orEmpty().isNotEmpty()
        Text(if (canOpen) "保存二维码并打开$appName" else "保存二维码", fontWeight = FontWeight.SemiBold)
    }
    Spacer(Modifier.height(6.dp))
    Text(
        "在${scanner}的「扫一扫」里从相册选这张二维码；也可以用另一台手机直接扫屏幕。",
        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(8.dp))
    Row(Modifier.fillMaxWidth()) {
        TextButton(onClick = onRefresh, enabled = state != "done", modifier = Modifier.weight(1f)) { Text("换一张") }
        TextButton(onClick = onCancel, enabled = state != "done", modifier = Modifier.weight(1f)) { Text("返回登录") }
    }
}

@Composable
private fun PolicyLink(title: String, onClick: () -> Unit) {
    Text(
        title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary,
        textDecoration = TextDecoration.Underline, modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
private fun CaptchaImage(
    source: String,
    modifier: Modifier,
    scale: ContentScale = ContentScale.Crop,
    description: String = "验证码，点击刷新",
) {
    val bitmap = remember(source) {
        if (!source.startsWith("data:")) null
        else runCatching {
            val bytes = Base64.decode(source.substringAfter(','), Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }.getOrNull()
    }
    Box(modifier.background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.Center) {
        if (bitmap != null) {
            Image(bitmap, contentDescription = description, contentScale = scale, modifier = Modifier.fillMaxSize())
        } else {
            Icon(Icons.Rounded.Refresh, contentDescription = "刷新验证码", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
