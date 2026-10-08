import Foundation
import StoreKit

/// StoreKit 2: 非消耗型 4 本。購入済みの商品 ID を `purchased` に保持し、変化を onEntitlementsChanged で知らせる
@MainActor
final class StoreManager: ObservableObject {
    static let productIDs: [String] = [
        "jp.hakoniwa.ds.robots",
        "jp.hakoniwa.ds.limits",
        "jp.hakoniwa.ds.sandbox",
        "jp.hakoniwa.ds.supporter",
    ]

    @Published private(set) var products: [Product] = []
    @Published private(set) var purchased: Set<String> = [] {
        didSet { if purchased != oldValue { onEntitlementsChanged?(purchased) } }
    }
    var onEntitlementsChanged: ((Set<String>) -> Void)?
    private var updates: Task<Void, Never>?

    init() {
        updates = listenForTransactions()
        Task {
            await loadProducts()
            await refreshEntitlements()
        }
    }

    deinit { updates?.cancel() }

    func loadProducts() async {
        do {
            let fetched = try await Product.products(for: Self.productIDs)
            products = Self.productIDs.compactMap { id in fetched.first { $0.id == id } }
        } catch {
            products = []
        }
    }

    /// 現在の権利（返金・取り消しは除く）
    func refreshEntitlements() async {
        var ids = Set<String>()
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.revocationDate == nil {
                ids.insert(t.productID)
            }
        }
        purchased = ids
    }

    func purchase(productID: String) async throws -> String {
        guard let product = products.first(where: { $0.id == productID }) else {
            if products.isEmpty { await loadProducts() }
            guard let p = products.first(where: { $0.id == productID }) else { throw StoreError.productNotFound }
            return try await purchase(productID: p.id)
        }
        let result = try await product.purchase()
        switch result {
        case .success(let verification):
            let transaction = try checkVerified(verification)
            purchased.insert(transaction.productID)
            await transaction.finish()
            return "purchased"
        case .pending:
            return "pending"
        case .userCancelled:
            return "cancelled"
        @unknown default:
            return "cancelled"
        }
    }

    func restore() async {
        try? await AppStore.sync()
        await refreshEntitlements()
    }

    /// JS に渡す商品情報
    func productInfos() -> [[String: Any]] {
        products.map { p in
            ["id": p.id, "title": p.displayName, "description": p.description, "price": p.displayPrice, "purchased": purchased.contains(p.id)]
        }
    }

    private func listenForTransactions() -> Task<Void, Never> {
        Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self else { return }
                if case .verified(let t) = result {
                    await t.finish()
                    await self.refreshEntitlements()
                }
            }
        }
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified: throw StoreError.failedVerification
        case .verified(let safe): return safe
        }
    }
}

enum StoreError: LocalizedError {
    case productNotFound
    case failedVerification
    var errorDescription: String? {
        switch self {
        case .productNotFound: return "商品が見つかりません"
        case .failedVerification: return "購入の検証に失敗しました"
        }
    }
}
