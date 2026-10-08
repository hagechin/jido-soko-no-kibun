import XCTest
@testable import HakoniwaDS

final class SchemeHandlerTests: XCTestCase {
    func testMimeTypes() {
        XCTAssertEqual(AppSchemeHandler.mimeType(forExtension: "html"), "text/html")
        XCTAssertEqual(AppSchemeHandler.mimeType(forExtension: "JS"), "text/javascript")
        XCTAssertEqual(AppSchemeHandler.mimeType(forExtension: "css"), "text/css")
        XCTAssertEqual(AppSchemeHandler.mimeType(forExtension: "webmanifest"), "application/manifest+json")
        XCTAssertEqual(AppSchemeHandler.mimeType(forExtension: "bin"), "application/octet-stream")
    }

    func testRootMapsToIndex() {
        let root = URL(fileURLWithPath: "/tmp/Web")
        XCTAssertEqual(AppSchemeHandler.fileURL(forPath: "/", webRoot: root).lastPathComponent, "index.html")
        XCTAssertEqual(AppSchemeHandler.fileURL(forPath: "", webRoot: root).lastPathComponent, "index.html")
        XCTAssertEqual(AppSchemeHandler.fileURL(forPath: "/_astro/a.css", webRoot: root).path, "/tmp/Web/_astro/a.css")
    }

    /// 同梱した Web 版が存在する（ios/sync-web.sh 済み）
    func testBundledWebExists() throws {
        let webRoot = try XCTUnwrap(Bundle.main.url(forResource: "Web", withExtension: nil), "Web フォルダが無い: ./ios/sync-web.sh を実行してから xcodegen generate")
        let index = AppSchemeHandler.fileURL(forPath: "/index.html", webRoot: webRoot)
        let html = try String(contentsOf: index, encoding: .utf8)
        XCTAssertTrue(html.contains("箱庭！ディストリビューション"), "index.html にタイトルが無い")
        XCTAssertFalse(FileManager.default.fileExists(atPath: webRoot.appendingPathComponent("sw.js").path), "sw.js は同梱しない")
    }
}
