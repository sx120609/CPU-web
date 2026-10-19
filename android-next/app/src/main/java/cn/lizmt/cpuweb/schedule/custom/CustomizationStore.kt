package cn.lizmt.cpuweb.schedule.custom

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

/**
 * The user's layout, theme and behavior choices. Every write goes through the
 * codec, so the stored value and the one on screen always satisfy the same
 * rules (tab count, valid routes, known card types).
 */
class CustomizationStore(context: Context) {
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    var value by mutableStateOf(load())
        private set

    /** False until the user has seen the 药大拾间 NEXT introduction. */
    var introSeen by mutableStateOf(prefs.getBoolean(KEY_INTRO, false))
        private set

    fun update(transform: (Customization) -> Customization) {
        val next = normalize(transform(value))
        if (next == value) return
        value = next
        prefs.edit().putString(KEY_VALUE, CustomizationCodec.toJson(next).toString()).apply()
    }

    fun reset() = update { Customization() }

    /** Applies a share code; false when the text is not a valid code. */
    fun import(code: String): Boolean {
        val imported = CustomizationCodec.fromShareCode(code, keepPrivateFrom = value) ?: return false
        update { imported }
        return true
    }

    fun markIntroSeen() {
        introSeen = true
        prefs.edit().putBoolean(KEY_INTRO, true).apply()
    }

    /** Shows the 药大拾间 NEXT introduction again (settings → 布局方案). */
    fun replayIntro() {
        introSeen = false
        prefs.edit().putBoolean(KEY_INTRO, false).apply()
    }

    private fun load(): Customization {
        val raw = prefs.getString(KEY_VALUE, null) ?: return Customization()
        return runCatching { CustomizationCodec.fromJson(JSONObject(raw)) }.getOrDefault(Customization())
    }

    companion object {
        private const val PREFS = "native_customization"
        private const val KEY_VALUE = "v1"
        // v2: NEXT 1.1 (今天, 日程, 拾间AI) introduces itself once more.
        private const val KEY_INTRO = "next_intro_seen_v2"

        fun normalize(value: Customization): Customization =
            CustomizationCodec.fromJson(CustomizationCodec.toJson(value))
    }
}
