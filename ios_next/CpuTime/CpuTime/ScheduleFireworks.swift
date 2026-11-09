import SwiftUI

/// Fireworks over a holiday's empty day: a few bursts from a point, sparks
/// flying out under gravity and fading. Drawn in one Canvas from a fixed seed,
/// so every play looks the same and costs little; nothing is shown with
/// Reduce Motion.
@available(iOS 17.0, *)
struct ScheduleFireworks: View {
    /// When the show began; it lasts `duration`.
    let startedAt: Date
    var duration: Double = 3.2

    private struct Spark {
        let burst: Int
        let angle: Double
        let speed: Double
        let size: Double
        let hue: Double
    }

    private struct Burst {
        let x: Double
        let y: Double
        let delay: Double
        let hue: Double
    }

    private static let bursts: [Burst] = [
        Burst(x: 0.5, y: 0.34, delay: 0.0, hue: 0.98),
        Burst(x: 0.24, y: 0.22, delay: 0.35, hue: 0.12),
        Burst(x: 0.77, y: 0.26, delay: 0.6, hue: 0.55),
        Burst(x: 0.38, y: 0.12, delay: 1.0, hue: 0.82),
        Burst(x: 0.66, y: 0.42, delay: 1.25, hue: 0.32),
    ]

    private static let sparks: [Spark] = {
        var result: [Spark] = []
        var seed: UInt64 = 0x9E3779B97F4A7C15
        func next() -> Double {
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Double(seed >> 11) / Double(1 << 53)
        }
        for (index, burst) in bursts.enumerated() {
            let count = 36
            for spark in 0..<count {
                let angle = Double(spark) / Double(count) * 2 * .pi + next() * 0.2
                result.append(Spark(burst: index, angle: angle, speed: 0.55 + next() * 0.45,
                                    size: 3 + next() * 2.8, hue: burst.hue + (next() - 0.5) * 0.08))
            }
        }
        return result
    }()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60)) { context in
            let elapsed = context.date.timeIntervalSince(startedAt)
            Canvas { graphics, size in
                let reach = min(size.width, size.height) * 0.32
                for spark in Self.sparks {
                    let burst = Self.bursts[spark.burst]
                    let t = elapsed - burst.delay
                    guard t > 0, t < 1.8 else { continue }
                    let progress = 1 - pow(1 - min(t / 1.1, 1), 3)
                    let distance = reach * spark.speed * progress
                    let x = burst.x * size.width + cos(spark.angle) * distance
                    let y = burst.y * size.height + sin(spark.angle) * distance + 40 * t * t
                    let fade = max(0, 1 - t / 1.8)
                    let color = Color(hue: spark.hue.truncatingRemainder(dividingBy: 1), saturation: 0.85, brightness: 1)
                    let radius = spark.size * (0.6 + 0.4 * fade)
                    graphics.opacity = fade
                    graphics.fill(Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)),
                                  with: .color(color))
                    // A short trail back towards the centre.
                    var trail = Path()
                    trail.move(to: CGPoint(x: x, y: y))
                    trail.addLine(to: CGPoint(x: x - cos(spark.angle) * 18 * fade, y: y - sin(spark.angle) * 18 * fade))
                    graphics.stroke(trail, with: .color(color.opacity(0.5)), lineWidth: radius * 0.8)
                }
                // The flash of each burst.
                for burst in Self.bursts {
                    let t = elapsed - burst.delay
                    guard t > 0, t < 0.35 else { continue }
                    let radius = 26 * (t / 0.35)
                    graphics.opacity = 1 - t / 0.35
                    graphics.fill(Path(ellipseIn: CGRect(x: burst.x * size.width - radius, y: burst.y * size.height - radius,
                                                         width: radius * 2, height: radius * 2)),
                                  with: .color(.white.opacity(0.7)))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
