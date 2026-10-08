import XCTest
@testable import HakoniwaDS

final class BridgeTests: XCTestCase {
    func testJsonEncodesDictionaries() {
        let json = Bridge.json(["ok": true, "result": ["ids": ["a", "b"]]])
        XCTAssertNotNil(json)
        XCTAssertTrue(json!.contains("\"ok\":true"))
        XCTAssertTrue(json!.contains("\"ids\":[\"a\",\"b\"]"))
    }

    func testJsStringEscapes() {
        XCTAssertEqual(Bridge.jsString("entitlements"), "\"entitlements\"")
        XCTAssertEqual(Bridge.jsString("a\"b"), "\"a\\\"b\"")
    }

    func testJsonRejectsInvalidObjects() {
        XCTAssertNil(Bridge.json(["bad": Date()]))
    }
}
