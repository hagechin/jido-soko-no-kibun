import XCTest
import StoreKitTest
@testable import HakoniwaDS

/// ローカルの StoreKit 構成（Products.storekit）で購入フローを自動テストする
@MainActor
final class StoreManagerTests: XCTestCase {
    private var session: SKTestSession!

    override func setUp() async throws {
        session = try SKTestSession(configurationFileNamed: "Products")
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()
    }

    override func tearDown() async throws {
        session.clearTransactions()
        session = nil
    }

    func testLoadsFourNonConsumables() async throws {
        let store = StoreManager()
        await store.loadProducts()
        XCTAssertEqual(store.products.map(\.id), StoreManager.productIDs)
        for p in store.products { XCTAssertEqual(p.type, .nonConsumable) }
        XCTAssertEqual(store.productInfos().count, 4)
        XCTAssertTrue(store.productInfos().allSatisfy { ($0["purchased"] as? Bool) == false })
    }

    func testPurchaseUnlocksSandboxAndNotifies() async throws {
        let store = StoreManager()
        await store.loadProducts()
        var notified: Set<String> = []
        store.onEntitlementsChanged = { notified = $0 }
        let state = try await store.purchase(productID: "jp.hatte.hakoniwa.ds.sandbox")
        XCTAssertEqual(state, "purchased")
        XCTAssertTrue(store.purchased.contains("jp.hatte.hakoniwa.ds.sandbox"))
        XCTAssertTrue(notified.contains("jp.hatte.hakoniwa.ds.sandbox"))
        await store.refreshEntitlements()
        XCTAssertTrue(store.purchased.contains("jp.hatte.hakoniwa.ds.sandbox"))
        XCTAssertFalse(store.purchased.contains("jp.hatte.hakoniwa.ds.robots"))
        let infos = store.productInfos()
        XCTAssertEqual(infos.first { ($0["id"] as? String) == "jp.hatte.hakoniwa.ds.sandbox" }?["purchased"] as? Bool, true)
    }

    func testRestoreFindsTransactionsMadeOutsideTheApp() async throws {
        try await session.buyProduct(identifier: "jp.hatte.hakoniwa.ds.supporter")
        let store = StoreManager()
        await store.loadProducts()
        await store.restore()
        XCTAssertTrue(store.purchased.contains("jp.hatte.hakoniwa.ds.supporter"))
    }

    func testRefundedPurchaseIsRevoked() async throws {
        let store = StoreManager()
        await store.loadProducts()
        _ = try await store.purchase(productID: "jp.hatte.hakoniwa.ds.limits")
        XCTAssertTrue(store.purchased.contains("jp.hatte.hakoniwa.ds.limits"))
        let tx = try XCTUnwrap(session.allTransactions().first { $0.productIdentifier == "jp.hatte.hakoniwa.ds.limits" })
        try session.refundTransaction(identifier: UInt(tx.identifier))
        // 返金は currentEntitlements にすぐ反映されないことがある（Transaction.updates で届く）。最大 10 秒待つ
        let revoked = await waitUntil(timeout: 10) {
            await store.refreshEntitlements()
            return !store.purchased.contains("jp.hatte.hakoniwa.ds.limits")
        }
        XCTAssertTrue(revoked, "返金後も jp.hatte.hakoniwa.ds.limits の権利が残っている")
    }

    /// 条件が真になるまで 250ms ごとに試す
    private func waitUntil(timeout: TimeInterval, _ cond: () async -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await cond() { return true }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        return await cond()
    }
}
