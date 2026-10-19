package cn.lizmt.cpuweb.schedule

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/** Android launcher reconfiguration; saving affects only the selected widget. */
class ScheduleWidgetConfigureActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setResult(RESULT_CANCELED)
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val manager = AppWidgetManager.getInstance(this)
        val info = manager.getAppWidgetInfo(id)
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID || info?.provider?.packageName != packageName) {
            finish()
            return
        }
        val mode = ScheduleWidgetProvider.modeForProvider(info.provider.className)
        val options = ScheduleWidgetOptions.load(this, id, mode)
        setContent {
            CpuTheme("system") {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp)) {
                        Text("编辑小组件", style = MaterialTheme.typography.headlineSmall)
                        Spacer(Modifier.height(8.dp))
                        Text("设置仅应用于这个桌面小组件", style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.height(20.dp))
                        if (mode == ScheduleWidgetProvider.WidgetMode.LARGE) {
                            Choice("显示哪两天", "今天和最近有课的一天", "今天和明天", options.tomorrow) { options.tomorrow = it }
                        } else {
                            Choice("今天的课上完后", "接着显示下一次课", "只看今天", options.todayOnly) { options.todayOnly = it }
                        }
                        if (mode == ScheduleWidgetProvider.WidgetMode.COMPACT) {
                            Choice("显示几节课", "当前和下一节", "只显示一节", options.courseCount == 1) { options.courseCount = if (it) 1 else 2 }
                        }
                        if (mode == ScheduleWidgetProvider.WidgetMode.LARGE || mode == ScheduleWidgetProvider.WidgetMode.TODAY_LARGE) {
                            Choice("显示方式", "时间线", "列表", !options.timeline) { options.timeline = !it }
                        }
                        Toggle("课程名称", options.showCourseName) { options.showCourseName = it }
                        Toggle("教室", options.showRoom) { options.showRoom = it }
                        Toggle("教师", options.showTeacher) { options.showTeacher = it }
                        Toggle("上课时间", options.showTime) { options.showTime = it }
                        Toggle("农历日期", options.showLunarDate) { options.showLunarDate = it }
                        Toggle("节假日提示", options.showHoliday) { options.showHoliday = it }
                        Spacer(Modifier.height(16.dp))
                        Button(onClick = {
                            options.save(this@ScheduleWidgetConfigureActivity, id)
                            ScheduleWidgetProvider.updateWidget(applicationContext, manager, id, mode)
                            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
                            finish()
                        }, modifier = Modifier.fillMaxWidth()) { Text("保存") }
                        TextButton(onClick = { finish() }, modifier = Modifier.fillMaxWidth()) { Text("取消") }
                    }
                }
            }
        }
    }
}

@Composable
private fun Choice(title: String, first: String, second: String, initial: Boolean, onChange: (Boolean) -> Unit) {
    var selected by remember { mutableStateOf(initial) }
    Text(title, style = MaterialTheme.typography.titleSmall)
    Column(Modifier.selectableGroup()) {
        listOf(first, second).forEachIndexed { index, label ->
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(
                selected = selected == (index == 1), role = Role.RadioButton,
                onClick = { selected = index == 1; onChange(selected) }
            ), verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected == (index == 1), onClick = null)
                Spacer(Modifier.width(12.dp))
                Text(label, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
    Spacer(Modifier.height(12.dp))
}

@Composable
private fun Toggle(label: String, initial: Boolean, onChange: (Boolean) -> Unit) {
    var checked by remember { mutableStateOf(initial) }
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(checked, onCheckedChange = { checked = it; onChange(it) })
    }
}
