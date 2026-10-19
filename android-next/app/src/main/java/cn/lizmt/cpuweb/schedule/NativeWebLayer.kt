package cn.lizmt.cpuweb.schedule

import android.content.Context
import android.graphics.Rect
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ProgressBar

/** A real Android sibling of the Compose shell, never an AndroidView inside it. */
class NativeWebLayer(context: Context) : FrameLayout(context) {
    private var page: WebView? = null
    private val loading = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
        isIndeterminate = true
        visibility = View.GONE
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private var action: View? = null
    private var bounds = Rect()

    init {
        visibility = View.INVISIBLE
        addView(loading, LayoutParams(LayoutParams.MATCH_PARENT, (2 * resources.displayMetrics.density).toInt(), Gravity.TOP))
    }

    fun bind(next: WebView) {
        if (page === next) return
        page?.let(::removeView)
        (next.parent as? ViewGroup)?.removeView(next)
        page = next
        addView(next, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    fun setAction(view: View) {
        action?.let(::removeView)
        action = view
        val inset = (16 * resources.displayMetrics.density).toInt()
        addView(view, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.END).apply {
            setMargins(inset, inset, inset, inset)
        })
    }

    fun place(left: Int, top: Int, width: Int, height: Int) {
        val next = Rect(left, top, left + width, top + height)
        if (next == bounds) return
        bounds = next
        layoutParams = LayoutParams(width, height).apply { leftMargin = left; topMargin = top }
        // Compose reports positions from inside the parent's layout pass, where Android
        // drops this request; after a rotation the page then kept its old size. Ask again
        // once that pass is over.
        post { requestLayout() }
    }

    fun showPage(visible: Boolean, showLoading: Boolean, showAction: Boolean) {
        visibility = if (visible && bounds.width() > 0 && bounds.height() > 0) View.VISIBLE else View.INVISIBLE
        importantForAccessibility = if (visible) View.IMPORTANT_FOR_ACCESSIBILITY_AUTO else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        loading.visibility = if (showLoading) View.VISIBLE else View.GONE
        action?.visibility = if (showAction) View.VISIBLE else View.GONE
    }
}
