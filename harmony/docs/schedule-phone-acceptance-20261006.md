# 鸿蒙手机课表对齐与 12 节配置验收

2026-10-06。以仓库 `web/src/views/schedule/styles` 的布局和课程颜色为基线，保留原生控件、已有日／周滑动与课表功能。

> 2026-10-07 补记：本记录写于一个落后于 `main` 的本地工作区。合并到 `main` 时，下文提到的共享课表桥修改没有采用——`main` 上的共享桥已经传递校历节次，并保留了登录初始化、默认周和学期选项的既有实现；随包桥按 `main` 的源码重新生成。课表顶部和网格随后按 iOS、安卓客户端重做，最终状态与验收结果见 [3.0.3 发布记录](release-3.0.3.md)。

## 修复

- 日视图将日期条和日分页放入同一个纵向容器，避免 `Refresh` 的多个直接子节点重叠；日期条占用独立的 52 vp，课程从下方开始。
- 节次数量及起止时间优先读取 `calendar.periods`，兼容快照的 `periods`。周／日网格高度、课程范围、详情、编辑器和导出共同使用这份配置，12 节不会再截为 11 节。旧服务端未配置节次时保留原有时间表作为兼容数据。
- 共享桥传递校历配置的全部节次，随包 `NativeWebCompatibility.js` 已重新生成。
- 日视图中的上一周／下一周直接更新课表周次，避免操作未挂载的周分页控制器。
- 手机宽度下按 Web 的字体、间距、课程渐变和边框绘制，并对齐日／周顺序、彩色选中边框和周次控件。

## 手机模拟器证据

设备为 `CPUWeb_Phone_Schedule_API24`，1080 × 2340，480 dpi（360 vp 宽），HarmonyOS 6.1.1 / API 24，HDC 目标 `127.0.0.1:5555`。验收仅通过 HDC / uitest 命令输入和设备截图完成。

使用隔离包 `cn.lizmt.cpuweb.scheduleqa`，实际 `NativeSchedulePage`、`NativeScheduleBody` 和 `NativeScheduleStore`，配合离线校历、12 节配置与课程数据。测试时间刻意区别于旧时间表，用于检查配置是否进入界面；截图中的 19:00–19:45 是验收数据。

9 组模拟器检查全部通过：

1. 周课表、第 12 节、底栏留白。
2. 上下周、左右滑动、连续切周。
3. 周次选择器与最后一周。
4. 日视图日期条不重叠、日期切换、课程详情。
5. 空课日、长名称、单节课程和重叠课程选择。
6. 日视图第 12 节及其详情节次、配置时间。
7. 深色周／日视图。
8. 九套主题。
9. 加载、授权失效和失败状态。

本机证据位于 `C:/Users/Carbene/.codex/artifacts/harmony-schedule-20261006/`：

- `results.json`：逐项验收结果。
- `day-light.png`：修复后的日期条与第一节。
- `week-last-period.png`、`day-last-period.png`、`twelfth-period-detail.png`：第 12 节和配置时间。
- `theme-*.png`、`week-dark.png`、`day-dark.png`、`state-*.png`：主题、深色与状态截图。
- `schedule-acceptance.hap`：用于上述验收的隔离调试包。

## 测试和构建

`node --test harmony/tests/*.test.mjs`：100 项通过，包括 12 节配置优先级、缓存恢复、分页预览、编辑器、文本／ICS 导出和动态网格几何。

共享桥测试：修改前 31 项中 26 项通过，修改后 32 项中 27 项通过；新增 12 节传递测试通过。前后相同的 5 个既有失败为 bootstrap guest、native ID、legacy week default、historical semester selector、parallel source records。修改前对照仅在临时副本中撤除本次桥改动，没有覆盖工作区文件。对应日志为 `schedule-bridge-baseline.log`、`schedule-bridge-after.log`。

正式入口的无签名调试 HAP 在独立构建副本中编译通过，日志为 `final-app-compile.log`，输出为 `cpuweb-final-unsigned.hap`。此记录不证明真实账号登录读取、签名发布或生产部署；本次没有推送和部署。

## 重现

将 `harmony/` 复制到独立的、路径名包含 `schedule` 的构建目录，先执行 `prepare-schedule-acceptance.mjs <构建目录>`，用 DevEco SDK 编译并通过 HDC 安装生成的 HAP，再执行：

```powershell
node harmony/scripts/verify-schedule-emulator.mjs <hdc.exe路径> 127.0.0.1:5555 <证据目录>
```

该脚本仅停止和启动隔离验收包，不使用 Windows 桌面输入。

## 3.0.3 发布复测

同日后续修复共享桥的登录初始化、默认周和学期选项问题，并更新课程 ID 及多单元记录的过时测试断言。鸿蒙与共享桥共 134 项通过，额外 8 项原生桥兼容测试通过。正式签名包和手机复测证据见 [3.0.3 发布记录](release-3.0.3.md)，以上 5 个失败保留为此前阶段的历史记录。
