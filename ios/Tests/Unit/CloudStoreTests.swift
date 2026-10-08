import XCTest
@testable import HakoniwaDS

final class CloudStoreTests: XCTestCase {
    func testPackUnpackRoundTripAndShrinks() throws {
        // セーブに似た、繰り返しの多い JSON
        var parts: [String] = []
        for i in 0..<2000 { parts.append("{\"id\":\(i),\"item\":\"apple\",\"qty\":20,\"purpose\":null}") }
        let text = "{\"version\":2,\"savedAt\":1700000000000,\"world\":{\"bins\":[\(parts.joined(separator: ","))]}}"
        let packed = try XCTUnwrap(CloudStore.pack(text))
        XCTAssertLessThan(packed.count, text.utf8.count / 5, "zlib で 1/5 以下になるはず")
        XCTAssertEqual(CloudStore.unpack(packed), text)
    }

    func testUnpackRejectsGarbage() {
        XCTAssertNil(CloudStore.unpack(Data([0x01, 0x02, 0x03])))
    }

    func testJapaneseSurvives() throws {
        let text = "{\"name\":\"棚ロボ 3\",\"theme\":\"ミッドナイト\"}"
        XCTAssertEqual(CloudStore.unpack(try XCTUnwrap(CloudStore.pack(text))), text)
    }
}
