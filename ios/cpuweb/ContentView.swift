import SwiftUI

@main
struct CPUWebApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @StateObject private var model = WebViewModel()

    var body: some View {
        ZStack {
            Color(red: 248 / 255, green: 250 / 255, blue: 252 / 255)
                .ignoresSafeArea()

            WebViewContainer(model: model)
                .opacity(model.phase == .content ? 1 : 0)

            switch model.phase {
            case .loading:
                LaunchView()
                    .transition(.opacity)
            case .failed:
                ErrorView(retry: model.retry)
                    .transition(.opacity)
            case .content:
                EmptyView()
            }
        }
        .animation(.easeOut(duration: 0.18), value: model.phase)
        .onOpenURL(perform: model.open)
        .preferredColorScheme(.light)
    }
}

private struct LaunchView: View {
    var body: some View {
        VStack(spacing: 0) {
            AppMark()
                .frame(width: 72, height: 72)
                .shadow(color: .black.opacity(0.12), radius: 10, y: 5)
                .padding(.bottom, 20)

            Text("药大拾间")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(Color(red: 23 / 255, green: 32 / 255, blue: 51 / 255))
                .padding(.bottom, 10)

            Text("正在打开你的校园服务")
                .font(.system(size: 15))
                .foregroundStyle(Color(red: 102 / 255, green: 112 / 255, blue: 133 / 255))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            LinearGradient(
                colors: [
                    Color(red: 237 / 255, green: 244 / 255, blue: 1),
                    Color(red: 248 / 255, green: 250 / 255, blue: 252 / 255),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }
}

private struct AppMark: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 68 / 255, green: 110 / 255, blue: 235 / 255),
                            Color(red: 83 / 255, green: 76 / 255, blue: 211 / 255),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            Image(systemName: "calendar")
                .font(.system(size: 36, weight: .semibold))
                .foregroundStyle(.white)
        }
    }
}

private struct ErrorView: View {
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 36, weight: .medium))
                .foregroundStyle(Color(red: 71 / 255, green: 85 / 255, blue: 105 / 255))
                .padding(.bottom, 18)

            Text("页面暂时无法打开")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255))

            Text("请检查网络连接，或稍后重试。")
                .font(.system(size: 14))
                .foregroundStyle(Color(red: 71 / 255, green: 85 / 255, blue: 105 / 255))
                .padding(.top, 10)
                .padding(.bottom, 20)

            Button("重新打开课表", action: retry)
                .buttonStyle(.borderedProminent)
                .tint(Color(red: 67 / 255, green: 56 / 255, blue: 202 / 255))
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 246 / 255, green: 248 / 255, blue: 251 / 255))
    }
}

#Preview {
    ContentView()
}
