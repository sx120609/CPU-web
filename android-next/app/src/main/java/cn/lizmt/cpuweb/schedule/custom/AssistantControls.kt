package cn.lizmt.cpuweb.schedule.custom

/**
 * The parts of the layout 拾间AI may change once the user confirms: each
 * change starts from the current value and touches only its own fields, so
 * taking it back leaves the user's other edits alone.
 */
object AssistantControls {
    /** The switches it may flip, named as settings names them. */
    val settings = linkedMapOf(
        "pureBlack" to "纯黑深色",
        "haptics" to "触感反馈",
        "reduceMotion" to "减弱动态效果",
        "keepScreenOn" to "看课表时保持亮屏",
        "secureScreen" to "隐私模式（禁止截屏）",
        "doubleTapRefresh" to "再点一次当前标签刷新",
        "webTheme" to "网页跟着换主题色",
        "postButton" to "首页投稿按钮",
    )

    fun setting(value: Customization, key: String): Boolean? = when (key) {
        "pureBlack" -> value.pureBlack
        "haptics" -> value.haptics
        "reduceMotion" -> value.reduceMotion
        "keepScreenOn" -> value.keepScreenOn
        "secureScreen" -> value.secureScreen
        "doubleTapRefresh" -> value.doubleTapRefresh
        "webTheme" -> value.webTheme
        "postButton" -> value.postButton
        else -> null
    }

    fun withSetting(value: Customization, key: String, on: Boolean): Customization? = when (key) {
        "pureBlack" -> value.copy(pureBlack = on)
        "haptics" -> value.copy(haptics = on)
        "reduceMotion" -> value.copy(reduceMotion = on)
        "keepScreenOn" -> value.copy(keepScreenOn = on)
        "secureScreen" -> value.copy(secureScreen = on)
        "doubleTapRefresh" -> value.copy(doubleTapRefresh = on)
        "webTheme" -> value.copy(webTheme = on)
        "postButton" -> value.copy(postButton = on)
        else -> null
    }

    /** The bar with [ids] (tab-eligible, distinct, at most six); null when fewer than two remain. */
    fun withTabs(value: Customization, ids: List<String>, launch: String?): Customization? {
        val tabs = ids.filter { value.destination(it)?.tabEligible == true }.distinct().take(MAX_TABS)
        if (tabs.size < MIN_TABS) return null
        val start = launch?.takeIf { it in tabs } ?: value.launchTab.takeIf { it in tabs } ?: tabs.first()
        return value.copy(tabs = tabs, launchTab = start)
    }

    /** What a layout preset sets, taken from [from] and put on [value]. */
    fun withPresetFields(value: Customization, from: Customization): Customization = value.copy(
        tabs = from.tabs, launchTab = from.launchTab, tabBarStyle = from.tabBarStyle,
        tabLabels = from.tabLabels, postButton = from.postButton,
    )

    /**
     * 今天 with one more section. A countdown or a note goes first, where it is
     * seen; other sections go last. Null when the section type is unknown, a
     * countdown has no day, or a section that appears once is already there.
     */
    fun withTodayCard(value: Customization, type: String, title: String, date: String, text: String, newId: () -> String): Pair<Customization, DashboardCard>? {
        if (type !in DashboardCards.types) return null
        val cards = value.dashboard.cards
        if (type !in DashboardCards.repeatable && cards.any { it.type == type }) return null
        if (type == "countdown" && !Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(date)) return null
        val id = if (type in DashboardCards.repeatable) "$type-${newId()}" else type
        val name = title.trim().take(16)
        val card = when (type) {
            "countdown" -> DashboardCard(id, type, title = name.ifEmpty { "倒计时" }, date = date)
            "note" -> DashboardCard(id, type, title = name.ifEmpty { "便签" }, text = text.take(2_000))
            "shortcuts" -> DashboardCard(id, type, title = name.ifEmpty { "常用" }, items = listOf("forum", "announcements", "market", "tools"))
            else -> DashboardCard(id, type)
        }
        val next = if (type == "countdown" || type == "note") listOf(card) + cards else cards + card
        return value.copy(dashboard = value.dashboard.copy(cards = next)) to card
    }

    /** The sections of [type] with their places, so they can be put back. */
    fun todayCardsOf(value: Customization, type: String): List<IndexedValue<DashboardCard>> =
        value.dashboard.cards.withIndex().filter { it.value.type == type }

    fun withoutTodayCards(value: Customization, type: String): Customization =
        value.copy(dashboard = value.dashboard.copy(cards = value.dashboard.cards.filter { it.type != type }))

    fun withoutTodayCard(value: Customization, id: String): Customization =
        value.copy(dashboard = value.dashboard.copy(cards = value.dashboard.cards.filter { it.id != id }))

    /** Puts removed sections back where they were, skipping any the user has added again since. */
    fun withRestoredTodayCards(value: Customization, removed: List<IndexedValue<DashboardCard>>): Customization {
        val cards = value.dashboard.cards.toMutableList()
        for ((index, card) in removed.sortedBy { it.index }) {
            if (cards.any { it.id == card.id || (card.type !in DashboardCards.repeatable && it.type == card.type) }) continue
            cards.add(index.coerceAtMost(cards.size), card)
        }
        return value.copy(dashboard = value.dashboard.copy(cards = cards))
    }
}
