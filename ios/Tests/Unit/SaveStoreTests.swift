import XCTest
@testable import HakoniwaDS

final class SaveStoreTests: XCTestCase {
    func testWriteReadDelete() throws {
        let store = SaveStore()
        let key = "test:save:\(UUID().uuidString)"
        XCTAssertNil(store.read(key: key))
        try store.write(key: key, text: "{\"version\":2,\"world\":{}}")
        XCTAssertEqual(store.read(key: key), "{\"version\":2,\"world\":{}}")
        try store.write(key: key, text: "updated")
        XCTAssertEqual(store.read(key: key), "updated")
        store.delete(key: key)
        XCTAssertNil(store.read(key: key))
    }

    func testKeyIsSanitizedToAFilename() throws {
        let store = SaveStore()
        let key = "jido-soko-no-kibun:save/../weird"
        try store.write(key: key, text: "x")
        XCTAssertEqual(store.read(key: key), "x")
        store.delete(key: key)
    }
}
