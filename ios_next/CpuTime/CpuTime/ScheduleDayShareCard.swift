import SwiftUI

/// The picture 分享这一天 makes: a tall card with the day's classes in time
/// order, each in its course colour, for a chat or a status update.
@available(iOS 17.0, *)
struct ScheduleDayShareCard: View {
    struct Item: Identifiable {
        let id: String
        let start: String
        let end: String
        let name: String
        let detail: String
        let tint: Color
        var cancelled = false
        var moved = false
    }

    let brand: String
    /// "11月12日 周四".
    let title: String
    /// "2026-2027 学年第一学期 · 第 10 周 · 农历十月廿四".
    let subtitle: String
    let items: [Item]
    /// Shown when there are no classes: "放假" or "这天没有课".
    let emptyText: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text(brand)
                    .font(.system(size: 18, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.9))
                Text(title)
                    .font(.system(size: 40, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.85))
                HStack(spacing: 8) {
                    Label(items.isEmpty ? "无课" : "\(items.filter { !$0.cancelled }.count) 节课", systemImage: "book.closed.fill")
                    if let first = items.first(where: { !$0.cancelled }), let last = items.last(where: { !$0.cancelled }) {
                        Label("\(first.start)–\(last.end)", systemImage: "clock.fill")
                    }
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.top, 6)
            }
            .padding(28)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                LinearGradient(colors: [Color.cpuBrand, Color.cpuBrand.opacity(0.75), Color.teal.opacity(0.85)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                    .overlay(alignment: .topTrailing) {
                        Circle().fill(.white.opacity(0.12)).frame(width: 220, height: 220).offset(x: 70, y: -90)
                    }
                    .overlay(alignment: .bottomTrailing) {
                        Circle().fill(.white.opacity(0.08)).frame(width: 140, height: 140).offset(x: 20, y: 60)
                    }
            }
            .clipped()

            VStack(spacing: 14) {
                if items.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "sun.max.fill")
                            .font(.system(size: 54))
                            .foregroundStyle(.orange.gradient)
                        Text(emptyText)
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                        Text("好好休息，或者去做点喜欢的事。")
                            .font(.system(size: 15))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 60)
                }
                ForEach(items) { item in row(item) }
            }
            .padding(22)

            HStack {
                Spacer()
                Text("由 \(brand) 生成")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 20)
        }
        .frame(width: 540)
        .background(Color(uiColor: .systemBackground))
    }

    private func row(_ item: Item) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .trailing, spacing: 4) {
                Text(item.start).font(.system(size: 20, weight: .bold).monospacedDigit())
                Text(item.end).font(.system(size: 14, weight: .medium).monospacedDigit()).foregroundStyle(.secondary)
            }
            .frame(width: 66, alignment: .trailing)
            RoundedRectangle(cornerRadius: 3).fill(item.tint).frame(width: 6)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(item.name)
                        .font(.system(size: 21, weight: .bold))
                        .strikethrough(item.cancelled)
                        .foregroundStyle(item.cancelled ? Color.secondary : Color.primary)
                    if item.cancelled { tag("停课", .gray) }
                    if item.moved { tag("调课", .orange) }
                }
                if !item.detail.isEmpty {
                    Text(item.detail).font(.system(size: 15)).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(item.tint.opacity(0.09), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func tag(_ text: String, _ color: Color) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .background(color, in: Capsule())
    }
}
