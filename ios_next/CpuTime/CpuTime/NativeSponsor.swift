import Combine
import StoreKit
import SwiftUI
import UIKit

// iOS 原生赞助：App Store 内购（消耗型商品）。网页的易支付赞助在 iOS 里不出现。
//
// 下单时带上服务端给的 appAccountToken（每个站内账号固定），购买成功后把 StoreKit 的 JWS 交易原文
// 交给 /api/payments/apple/sponsor/transactions，服务端校验签名、记赞助、发 VIP 和 AI 点数，
// 成功后才 finish 交易。没交成功的交易留在 StoreKit 里，App 回到前台或网页桥就绪时再交一次。

struct NativeSponsorProduct: Decodable, Identifiable, Hashable {
    let productId: String
    let amount: String
    let amountCents: Int
    let assistantPoints: Int
    var id: String { productId }
}

struct NativeSponsorCategory: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let description: String
    let goalAmount: String?
    let deadline: String?
    let raisedAmount: String
    let supporterCount: Int
    let progressPercent: Double?
    let accepting: Bool
    let featured: Bool
}

struct NativeSponsorOptions: Decodable {
    let enabled: Bool
    let title: String
    let description: String
    let allowMessage: Bool
    let wallEnabled: Bool
    let appAccountToken: String
    let pointsRatio: Double
    let products: [NativeSponsorProduct]
    let categories: [NativeSponsorCategory]
}

struct NativeSponsorOrder: Decodable, Identifiable {
    let id: Int
    let amount: String
    let categoryTitle: String
    let assistantPointsAwarded: Int
    let status: String
    let paidAt: String?
    let createdAt: String
}

struct NativeSponsorWallEntry: Decodable, Identifiable {
    struct User: Decodable { let nickname: String? }
    let id: Int
    let amount: String
    let categoryTitle: String
    let message: String
    let paidAt: String?
    let user: User?
    let anonymous: Bool
}

private struct NativeSponsorWall: Decodable {
    let enabled: Bool
    let list: [NativeSponsorWallEntry]?
}

private struct NativeSponsorEnvelope<T: Decodable>: Decodable { let data: T }
private struct NativeSponsorOrderList: Decodable { let list: [NativeSponsorOrder] }
private struct NativeSponsorSubmitResult: Decodable { let order: NativeSponsorOrder; let created: Bool }

/// 下单时选的类别、留言和展示方式。交易要等服务端确认后才 finish，中间断网或 App 被关掉时，
/// 下次补交仍用这里记下的选择（按商品记，一个商品同一时刻只会有一笔在付）。
private struct NativeSponsorIntent: Codable {
    let categoryId: String
    let message: String
    let displayMode: String
}

@MainActor
@available(iOS 17.0, *)
final class NativeSponsorService: ObservableObject {
    static let shared = NativeSponsorService()

    typealias APIRequest = @MainActor (_ path: String, _ method: String, _ body: [String: Any]?) async throws -> Data

    @Published private(set) var options: NativeSponsorOptions?
    @Published private(set) var storeProducts: [String: Product] = [:]
    @Published private(set) var orders: [NativeSponsorOrder] = []
    @Published private(set) var wall: [NativeSponsorWallEntry] = []
    @Published private(set) var isLoading = false
    @Published private(set) var loadError = ""

    private var apiRequest: APIRequest?
    private var updatesTask: Task<Void, Never>?
    private var submitting = Set<UInt64>()
    private let intentsKey = "nativeSponsor.intents.v1"

    func setAPIRequest(_ request: @escaping APIRequest) {
        apiRequest = request
    }

    /// 监听 StoreKit 的交易更新（家长批准、在别处完成的购买），并补交没处理完的交易。
    func activate() {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await result in StoreKit.Transaction.updates {
                await self?.submit(result)
            }
        }
        Task { await processUnfinished() }
    }

    func processUnfinished() async {
        for await result in StoreKit.Transaction.unfinished {
            await submit(result)
        }
    }

    // MARK: Loading

    func load() async {
#if DEBUG
        // `CPU_DEBUG_SPONSOR=mock`：不连站点，用示例数据看版式（商品价格取自 Sponsor.storekit，
        // 用 Xcode 运行并在 scheme 里选这个 StoreKit 配置文件时才有）。
        if ProcessInfo.processInfo.environment["CPU_DEBUG_SPONSOR"] == "mock" {
            options = Self.debugOptions
            let products = (try? await Product.products(for: Self.debugOptions.products.map(\.productId))) ?? []
            storeProducts = Dictionary(uniqueKeysWithValues: products.map { ($0.id, $0) })
            wall = Self.debugWall
            return
        }
#endif
        guard let apiRequest else {
            loadError = "登录服务正在启动，请稍候再试。"
            return
        }
        isLoading = true
        loadError = ""
        defer { isLoading = false }
        do {
            let data = try await apiRequest("/api/payments/apple/sponsor/options", "GET", nil)
            let loaded = try JSONDecoder().decode(NativeSponsorEnvelope<NativeSponsorOptions>.self, from: data).data
            options = loaded
            let products = try await Product.products(for: loaded.products.map(\.productId))
            storeProducts = Dictionary(uniqueKeysWithValues: products.map { ($0.id, $0) })
            if products.isEmpty { loadError = "暂时连不上 App Store，请稍后再试。" }
        } catch {
            loadError = (error as? LocalizedError)?.errorDescription ?? "赞助信息加载失败，请稍后再试。"
        }
        await loadOrders()
        await loadWall()
    }

    private func loadOrders() async {
        guard let apiRequest,
              let data = try? await apiRequest("/api/payments/apple/sponsor/orders", "GET", nil),
              let list = try? JSONDecoder().decode(NativeSponsorEnvelope<NativeSponsorOrderList>.self, from: data).data.list
        else { return }
        orders = list
    }

    private func loadWall() async {
        guard options?.wallEnabled == true, let apiRequest,
              let data = try? await apiRequest("/api/payments/sponsor/wall", "GET", nil),
              let loaded = try? JSONDecoder().decode(NativeSponsorEnvelope<NativeSponsorWall>.self, from: data).data
        else { return }
        wall = loaded.enabled ? Array((loaded.list ?? []).prefix(20)) : []
    }

    // MARK: Purchasing

    enum Outcome: Equatable {
        case completed(points: Int)
        case pending
        case cancelled
        case failed(String)
    }

    func purchase(
        _ product: Product,
        categoryId: String,
        message: String,
        displayMode: String,
        using purchase: PurchaseAction
    ) async -> Outcome {
        guard let token = options.flatMap({ UUID(uuidString: $0.appAccountToken) }) else {
            return .failed("赞助信息还没加载好，请稍后再试。")
        }
        saveIntent(NativeSponsorIntent(categoryId: categoryId, message: message, displayMode: displayMode), for: product.id)
        do {
            let result = try await purchase(product, options: [.appAccountToken(token)])
            switch result {
            case .success(let verification):
                return await submit(verification) ?? .failed("付款已完成，正在等待服务器确认，稍后会自动到账。")
            case .pending:
                return .pending
            case .userCancelled:
                return .cancelled
            @unknown default:
                return .cancelled
            }
        } catch {
            return .failed((error as? LocalizedError)?.errorDescription ?? "购买没有完成，请稍后再试。")
        }
    }

    /// 把交易交给服务端；成功（或服务端确认已退款）才 finish。返回 nil 表示这次没交成功，交易保留。
    @discardableResult
    private func submit(_ verification: VerificationResult<StoreKit.Transaction>) async -> Outcome? {
        guard case .verified(let transaction) = verification else {
            // 设备上验不过的交易（越狱、篡改）不会有服务端认可，直接结束掉。
            await verification.unsafePayloadValue.finish()
            return .failed("这笔购买没有通过 App Store 校验。")
        }
        guard NativeSponsorProductID.isSponsor(transaction.productID) else { return nil }
        guard !submitting.contains(transaction.id), let apiRequest else { return nil }
        submitting.insert(transaction.id)
        defer { submitting.remove(transaction.id) }
        let intent = intent(for: transaction.productID)
        var body: [String: Any] = ["signedTransaction": verification.jwsRepresentation]
        if let intent {
            body["categoryId"] = intent.categoryId
            body["message"] = intent.message
            body["displayMode"] = intent.displayMode
        }
        do {
            let data = try await apiRequest("/api/payments/apple/sponsor/transactions", "POST", body)
            let result = try JSONDecoder().decode(NativeSponsorEnvelope<NativeSponsorSubmitResult>.self, from: data).data
            await transaction.finish()
            clearIntent(for: transaction.productID)
            await loadOrders()
            return .completed(points: result.order.assistantPointsAwarded)
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? ""
            if message.contains("已退款") {
                await transaction.finish()
                clearIntent(for: transaction.productID)
            }
            return nil
        }
    }

    private func saveIntent(_ intent: NativeSponsorIntent, for productID: String) {
        var all = intents()
        all[productID] = intent
        UserDefaults.standard.set(try? JSONEncoder().encode(all), forKey: intentsKey)
    }

    private func intent(for productID: String) -> NativeSponsorIntent? { intents()[productID] }

    private func clearIntent(for productID: String) {
        var all = intents()
        all.removeValue(forKey: productID)
        UserDefaults.standard.set(try? JSONEncoder().encode(all), forKey: intentsKey)
    }

    private func intents() -> [String: NativeSponsorIntent] {
        guard let data = UserDefaults.standard.data(forKey: intentsKey),
              let decoded = try? JSONDecoder().decode([String: NativeSponsorIntent].self, from: data) else { return [:] }
        return decoded
    }

    // MARK: Presentation

    /// 网页「我的 → 去赞助」和 /sponsor 链接（`CPUTimeNative.openSponsor`）打开它。
    func present() {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let active = scenes.filter { $0.activationState == .foregroundActive }
        let windows = (active.isEmpty ? scenes : active).flatMap(\.windows)
        var top = (windows.first(where: \.isKeyWindow) ?? windows.first)?.rootViewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        guard let top, !(top is NativeSponsorHostingController) else { return }
        let controller = NativeSponsorHostingController(rootView: NativeSponsorView(service: self))
        controller.modalPresentationStyle = .pageSheet
        controller.sheetPresentationController?.prefersGrabberVisible = true
        top.present(controller, animated: true)
    }
}

#if DEBUG
@available(iOS 17.0, *)
extension NativeSponsorService {
    /// `CPU_DEBUG_SPONSOR=1`（或 `mock`）：启动后直接打开赞助页。
    func debugPresentIfRequested() {
        guard ProcessInfo.processInfo.environment["CPU_DEBUG_SPONSOR"] != nil else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            present()
        }
    }

    static let debugOptions = NativeSponsorOptions(
        enabled: true,
        title: "支持拾间",
        description: "赞助用于服务器、校园服务与长期维护，成功后金额会展示在你的个人资料里。",
        allowMessage: true,
        wallEnabled: true,
        appAccountToken: "6c1b2a8e-3d4f-5a6b-8c7d-9e0f1a2b3c4d",
        pointsRatio: 0.7,
        products: [(6, 840), (18, 2520), (30, 4200), (68, 9520), (128, 17920)].map {
            NativeSponsorProduct(productId: "cn.cputime.mobile.sponsor.\($0.0)", amount: "\($0.0).00", amountCents: $0.0 * 100, assistantPoints: $0.1)
        },
        categories: [
            NativeSponsorCategory(id: "app-store-2026", title: "App Store 首年上架计划", description: "用于 Apple Developer Program 与 App Store 首年上架相关费用。",
                                  goalAmount: "750.00", deadline: "2026-12-31", raisedAmount: "512.00", supporterCount: 37, progressPercent: 68, accepting: true, featured: true),
            NativeSponsorCategory(id: "general", title: "支持拾间", description: "用于服务器、校园服务与长期维护。",
                                  goalAmount: nil, deadline: nil, raisedAmount: "1024.00", supporterCount: 88, progressPercent: nil, accepting: true, featured: false),
        ]
    )

    static let debugWall = [
        NativeSponsorWallEntry(id: 1, amount: "30.00", categoryTitle: "支持拾间", message: "课表很好用，加油！", paidAt: nil, user: .init(nickname: "小药"), anonymous: false),
        NativeSponsorWallEntry(id: 2, amount: "6.00", categoryTitle: "App Store 首年上架计划", message: "", paidAt: nil, user: nil, anonymous: true),
    ]
}
#endif

enum NativeSponsorProductID {
    static let prefix = "cn.cputime.mobile.sponsor."
    static func isSponsor(_ id: String) -> Bool { id.hasPrefix(prefix) }
}

@available(iOS 17.0, *)
private final class NativeSponsorHostingController: UIHostingController<NativeSponsorView> {}

@available(iOS 17.0, *)
struct NativeSponsorView: View {
    @ObservedObject var service: NativeSponsorService
    @Environment(\.dismiss) private var dismiss
    @Environment(\.purchase) private var purchase

    @State private var categoryId = ""
    @State private var productId = ""
    @State private var message = ""
    @State private var displayMode = "public"
    @State private var isPurchasing = false
    @State private var resultMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let options = service.options {
                    content(options)
                } else if service.isLoading {
                    HStack { Spacer(); ProgressView(); Spacer() }
                        .listRowBackground(Color.clear)
                } else if !service.loadError.isEmpty {
                    Section { Text(service.loadError).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle(service.options?.title ?? "支持拾间")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
            .refreshable { await service.load() }
            .task {
                await service.load()
                selectDefaults()
            }
            .alert("赞助", isPresented: Binding(get: { resultMessage != nil }, set: { if !$0 { resultMessage = nil } })) {
                Button("好") { resultMessage = nil }
            } message: {
                Text(resultMessage ?? "")
            }
        }
        .tint(.cpuBrand)
    }

    @ViewBuilder
    private func content(_ options: NativeSponsorOptions) -> some View {
        Section {
            Text(options.description)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }

        if !options.enabled {
            Section { Text("赞助入口当前已关闭，已完成的赞助仍会保留展示。").foregroundStyle(.secondary) }
        } else {
            let categories = options.categories.filter(\.accepting)
            if categories.count > 1 {
                Section("支持哪一项") {
                    ForEach(categories) { category in
                        Button { categoryId = category.id } label: { categoryRow(category) }
                            .buttonStyle(.plain)
                    }
                }
            }

            Section {
                ForEach(options.products) { option in
                    Button { productId = option.productId } label: { productRow(option) }
                        .buttonStyle(.plain)
                        .disabled(service.storeProducts[option.productId] == nil)
                }
                if !service.loadError.isEmpty {
                    Text(service.loadError).font(.footnote).foregroundStyle(.secondary)
                }
            } header: {
                Text("金额")
            } footer: {
                Text("通过 App Store 付款。赞助后开通 VIP；AI 点数按 App Store 结算后到账的 \(Int((options.pointsRatio * 100).rounded()))% 计算。如需退款请向 Apple 申请，退款后相应的点数会扣回。")
            }

            Section("赞助墙") {
                if options.allowMessage {
                    TextField("留一句话（选填，80 字以内）", text: $message, axis: .vertical)
                        .lineLimit(1...3)
                        .onChange(of: message) { _, next in
                            if next.count > 80 { message = String(next.prefix(80)) }
                        }
                }
                Picker("展示方式", selection: $displayMode) {
                    Text("公开").tag("public")
                    Text("匿名").tag("anonymous")
                    Text("不展示").tag("hidden")
                }
            }

            Section {
                Button(action: buy) {
                    HStack {
                        Spacer()
                        if isPurchasing { ProgressView().padding(.trailing, 6) }
                        Text(buyTitle).font(.headline)
                        Spacer()
                    }
                }
                .disabled(isPurchasing || selectedStoreProduct == nil)
            }
        }

        if !service.orders.isEmpty {
            Section("我的赞助") {
                ForEach(service.orders) { order in
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(order.categoryTitle).font(.subheadline)
                            Text(orderDetail(order)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text("¥\(order.amount)").font(.subheadline.monospacedDigit())
                    }
                }
            }
        }

        if !service.wall.isEmpty {
            Section("感谢") {
                ForEach(service.wall) { entry in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(entry.anonymous ? "匿名" : (entry.user?.nickname ?? "同学")).font(.subheadline.weight(.medium))
                            Spacer()
                            Text("¥\(entry.amount)").font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        if !entry.message.isEmpty {
                            Text(entry.message).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func categoryRow(_ category: NativeSponsorCategory) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: categoryId == category.id ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(categoryId == category.id ? Color.cpuBrand : .secondary)
                .font(.title3)
            VStack(alignment: .leading, spacing: 4) {
                Text(category.title).font(.subheadline.weight(.semibold))
                if !category.description.isEmpty {
                    Text(category.description).font(.caption).foregroundStyle(.secondary)
                }
                if let progress = category.progressPercent, let goal = category.goalAmount {
                    ProgressView(value: min(max(progress, 0), 100), total: 100)
                    Text("已筹 ¥\(category.raisedAmount) / ¥\(goal) · \(category.supporterCount) 人支持")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .contentShape(Rectangle())
    }

    private func productRow(_ option: NativeSponsorProduct) -> some View {
        HStack {
            Image(systemName: productId == option.productId ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(productId == option.productId ? Color.cpuBrand : .secondary)
                .font(.title3)
            Text(service.storeProducts[option.productId]?.displayPrice ?? "¥\(option.amount.replacingOccurrences(of: ".00", with: ""))")
                .font(.body.weight(.semibold).monospacedDigit())
            Spacer()
            Text(option.assistantPoints > 0 ? "VIP + \(option.assistantPoints) AI 点数" : "VIP")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }

    private var selectedStoreProduct: Product? { service.storeProducts[productId] }

    private var buyTitle: String {
        guard let product = selectedStoreProduct else { return "选择金额" }
        return "赞助 \(product.displayPrice)"
    }

    private func orderDetail(_ order: NativeSponsorOrder) -> String {
        let date = String((order.paidAt ?? order.createdAt).prefix(10))
        switch order.status {
        case "refunded": return "\(date) · 已退款"
        case "sandbox": return "\(date) · 测试交易 · \(order.assistantPointsAwarded) 点"
        default: return "\(date) · \(order.assistantPointsAwarded) 点"
        }
    }

    private func selectDefaults() {
        guard let options = service.options else { return }
        let accepting = options.categories.filter(\.accepting)
        if categoryId.isEmpty || !accepting.contains(where: { $0.id == categoryId }) {
            categoryId = (accepting.first(where: \.featured) ?? accepting.first)?.id ?? ""
        }
        if productId.isEmpty, options.products.count > 1 {
            productId = options.products[1].productId
        } else if productId.isEmpty {
            productId = options.products.first?.productId ?? ""
        }
    }

    private func buy() {
        guard let product = selectedStoreProduct, !isPurchasing else { return }
        isPurchasing = true
        Task {
            let outcome = await service.purchase(
                product,
                categoryId: categoryId,
                message: message.trimmingCharacters(in: .whitespacesAndNewlines),
                displayMode: displayMode,
                using: purchase
            )
            isPurchasing = false
            switch outcome {
            case .completed(let points):
                message = ""
                resultMessage = points > 0 ? "谢谢你的支持！VIP 已开通，\(points) 个 AI 点数已到账。" : "谢谢你的支持！VIP 已开通。"
            case .pending:
                resultMessage = "这笔购买正在等待批准，批准后会自动到账。"
            case .cancelled:
                break
            case .failed(let text):
                resultMessage = text
            }
        }
    }
}
