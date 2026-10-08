import XCTest

/// アプリが起動し、同梱した Web 版が WKWebView の中で動き出すことのスモークテスト
final class LaunchUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launchFresh() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-resetSave"] // 残っているセーブに左右されないよう、新規開始で起動
        app.launch()
        return app
    }

    func testLaunchShowsTheWarehouseHud() throws {
        let app = launchFresh()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 20), "WKWebView が出ない")
        // HUD の日付「1年目 4月 第1週」など「年目」を含む文字が出る = JS が動いている
        let date = web.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "年目")).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 30), "HUD の日付が出ない（JS が動いていない可能性）")
        // 下のバーのボタン（設定）がタップできる大きさ
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "launch"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testTimeAdvancesWhileRunning() throws {
        let app = launchFresh()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 20))
        let date = web.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "年目")).firstMatch
        XCTAssertTrue(date.waitForExistence(timeout: 30), "HUD の日付が出ない")
        // 1 週 = 90 秒（ゲーム内）。4x にして待つ代わりに、オーダーカードの経過秒が増えることで動作を確かめる
        let order = web.staticTexts.containing(NSPredicate(format: "label MATCHES %@", "^[0-9]+s$")).firstMatch
        XCTAssertTrue(order.waitForExistence(timeout: 60), "オーダーの経過時間が出ない")
        let first = order.label
        sleep(5)
        XCTAssertNotEqual(order.label, first, "シミュレーションが進んでいない")
    }
}
