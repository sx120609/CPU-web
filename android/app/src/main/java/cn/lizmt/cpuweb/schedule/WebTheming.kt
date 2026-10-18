package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.os.Build
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.ui.graphics.Color
import cn.lizmt.cpuweb.schedule.custom.Customization
import cn.lizmt.cpuweb.schedule.custom.DestinationKind
import cn.lizmt.cpuweb.schedule.custom.WebTweaks
import org.json.JSONArray
import org.json.JSONObject

/**
 * The user's look carried into the site's own pages: accent, corners and pure
 * black through the site's CSS variables, plus the chosen page tweaks and the
 * user's own stylesheet. Selectors start with the native-shell attribute so
 * they outrank `:root` and `html[data-theme="dark"]` in the site bundle.
 */
object WebTheming {
    private const val NATIVE = "html[data-cpu-android-native]"
    private const val NATIVE_DARK = "html[data-cpu-android-native][data-theme=\"dark\"]"

    fun css(custom: Customization, context: Context?): String {
        val rules = StringBuilder()
        if (custom.webTheme) {
            accents(custom, context)?.let { (light, dark) ->
                rules.append(NATIVE).append('{').append(lightAccent(light)).append('}')
                rules.append(NATIVE_DARK).append('{').append(darkAccent(dark)).append('}')
            }
            if (custom.corners != 1f) {
                val c = custom.corners
                rules.append(NATIVE).append("{--cpu-radius-s:${px(6 * c)};--cpu-radius-m:${px(10 * c)};--cpu-radius-l:${px(14 * c)}}")
            }
            if (custom.pureBlack) {
                rules.append(NATIVE_DARK).append(
                    "{--cpu-bg:#000;--cpu-card:#0b0b0b;--cpu-surface:#0f0f0f;--cpu-surface-soft:#151515;" +
                        "--cpu-surface-subtle:#1c1c1c;--cpu-glass-bg:rgba(0,0,0,.86);--cpu-border-soft:#222;" +
                        "--el-bg-color:#0b0b0b;--el-bg-color-overlay:#111}",
                )
            }
        }
        WebTweaks.all.filter { it.id in custom.webTweaks }.forEach { rules.append(it.css) }
        if (custom.customCssEnabled && custom.customCss.isNotBlank()) rules.append('\n').append(custom.customCss)
        return rules.toString()
    }

    /** The light and dark accents to paint the site with; null keeps the site's own green. */
    private fun accents(custom: Customization, context: Context?): Pair<Color, Color>? = when {
        custom.accent == "dynamic" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && context != null ->
            dynamicLightColorScheme(context).primary to dynamicDarkColorScheme(context).primary
        custom.accent.startsWith("#") -> parseHex(custom.accent)?.let {
            accentScheme(it, dark = false).primary to accentScheme(it, dark = true).primary
        }
        else -> null
    }

    private fun lightAccent(p: Color) = listOf(
        "--cpu-primary" to p.toHex(),
        "--cpu-primary-light" to mix(p, Color.White, 0.18f).toHex(),
        "--cpu-primary-dark" to mix(p, Color.Black, 0.18f).toHex(),
        "--cpu-primary-soft" to mix(p, Color.White, 0.88f).toHex(),
        "--cpu-on-primary" to "#fff",
        "--el-color-primary" to p.toHex(),
        "--el-color-primary-light-3" to mix(p, Color.White, 0.3f).toHex(),
        "--el-color-primary-light-5" to mix(p, Color.White, 0.5f).toHex(),
        "--el-color-primary-light-7" to mix(p, Color.White, 0.7f).toHex(),
        "--el-color-primary-light-8" to mix(p, Color.White, 0.8f).toHex(),
        "--el-color-primary-light-9" to mix(p, Color.White, 0.9f).toHex(),
        "--el-color-primary-dark-2" to mix(p, Color.Black, 0.2f).toHex(),
    ).joinToString(";") { "${it.first}:${it.second}" }

    private fun darkAccent(p: Color) = listOf(
        "--cpu-primary" to p.toHex(),
        "--cpu-primary-light" to mix(p, Color.White, 0.2f).toHex(),
        "--cpu-primary-dark" to mix(p, Color.Black, 0.45f).toHex(),
        "--cpu-primary-soft" to rgba(p, 0.12f),
        "--cpu-on-primary" to mix(p, Color.Black, 0.8f).toHex(),
        "--el-color-primary" to p.toHex(),
        "--el-color-primary-light-3" to mix(p, Color.Black, 0.2f).toHex(),
        "--el-color-primary-light-5" to mix(p, Color.Black, 0.4f).toHex(),
        "--el-color-primary-light-7" to rgba(p, 0.24f),
        "--el-color-primary-light-8" to rgba(p, 0.16f),
        "--el-color-primary-light-9" to rgba(p, 0.10f),
        "--el-color-primary-dark-2" to mix(p, Color.White, 0.3f).toHex(),
    ).joinToString(";") { "${it.first}:${it.second}" }

    private fun rgba(color: Color, alpha: Float) =
        "rgba(${(color.red * 255).toInt()},${(color.green * 255).toInt()},${(color.blue * 255).toInt()},$alpha)"

    private fun px(value: Float) = "${"%.1f".format(java.util.Locale.ROOT, value)}px"

    /**
     * The page-side half of the user's layout, run at document start on the
     * site's origin: the stylesheet above, and the tab roots and titles the
     * page bridge uses for its back stack and top-bar titles.
     */
    fun documentScript(origin: String, css: String, custom: Customization): String {
        val roots = JSONArray()
        val titles = JSONObject()
        custom.tabDestinations.filter { it.kind == DestinationKind.Web }.forEach { tab ->
            val path = tab.route.substringBefore('?').substringBefore('#')
            roots.put(path)
            titles.put(path, if (tab.id == "home" && custom.labels["home"] == null) "药大拾间" else tab.title)
        }
        return "(function(o,c,r,t){if(location.origin!==o)return;" +
            "window.CPUAndroidTabRoots=r;window.CPUAndroidTabTitles=t;" +
            "var id='cpu-android-user-style';" +
            "var apply=function(){var s=document.getElementById(id);" +
            "if(!c){if(s)s.remove();return;}" +
            "if(!s){s=document.createElement('style');s.id=id;}" +
            "if(s.textContent!==c)s.textContent=c;" +
            "var p=document.head||document.documentElement;if(p&&p.lastElementChild!==s)p.appendChild(s);};" +
            "apply();if(document.readyState==='loading')addEventListener('DOMContentLoaded',apply,{once:true});" +
            "addEventListener('load',apply,{once:true});})(" +
            JSONObject.quote(origin) + "," + JSONObject.quote(css) + "," + roots + "," + titles + ");"
    }
}
