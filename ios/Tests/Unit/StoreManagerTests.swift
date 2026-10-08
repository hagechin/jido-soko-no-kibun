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
        let state = try await store.purchase(productID: "jp.hakoniwa.ds.sandbox")
        XCTAssertEqual(state, "purchased")
        XCTAssertTrue(store.purchased.contains("jp.hakoniwa.ds.sandbox"))
        XCTAssertTrue(notified.contains("jp.hakoniwa.ds.sandbox"))
        await store.refreshEntitlements()
        XCTAssertTrue(store.purchased.contains("jp.hakoniwa.ds.sandbox"))
        XCTAssertFalse(store.purchased.contains("jp.hakoniwa.ds.robots"))
        let infos = store.productInfos()
        XCTAssertEqual(infos.first { ($0["id"] as? String) == "jp.hakoniwa.ds.sandbox" }?["purchased"] as? Bool, true)
    }

    func testRestoreFindsTransactionsMadeOutsideTheApp() async throws {
        try await session.buyProduct(identifier: "jp.hakoniwa.ds.supporter")
        let store = StoreManager()
        await store.loadProducts()
        await store.restore()
        XCTAssertTrue(store.purchased.contains("jp.hakoniwa.ds.supporter"))
    }

    func testRefundedPurchaseIsRevoked() async throws {
        let store = StoreManager()
        await store.loadProducts()
        _ = try await store.purchase(productID: "jp.hakoniwa.ds.limits")
        XCTAssertTrue(store.purchased.contains("jp.hakoniwa.ds.limits"))
        let tx = try XCTUnwrap(session.allTransactions().first { $0.productIdentifier == "jp.hakoniwa.ds.limits" })
        try session.refundTransaction(identifier: UInt(tx.identifier))
        await store.refreshEntitlements()
        XCTAssertFalse(store.purchased.contains("jp.hakoniwa.ds.limits"))
    }
}
