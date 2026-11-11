import SwiftUI

@available(iOS 17.0, *)
private struct ScheduleCoupleKey: EnvironmentKey {
    static let defaultValue: NativeCoupleLayer? = nil
}

@available(iOS 17.0, *)
extension EnvironmentValues {
    /// The other timetable while it is laid over the user's, else nil.
    var scheduleCouple: NativeCoupleLayer? {
        get { self[ScheduleCoupleKey.self] }
        set { self[ScheduleCoupleKey.self] = newValue }
    }
}

extension CoupleRGB {
    var color: Color { Color(.sRGB, red: Double(red) / 255, green: Double(green) / 255, blue: Double(blue) / 255, opacity: 1) }
}

/// The small heart on a class both attend: in the day view's two columns,
/// and on the partner's card in the week view's overlay strip.
@available(iOS 17.0, *)
struct ScheduleCoupleHeart: View {
    var size: CGFloat = 9

    var body: some View {
        Image(systemName: "heart.fill")
            .font(.system(size: size))
            .foregroundStyle(CoupleRGB.heart.color)
            .accessibilityLabel("一起上的课")
    }
}
