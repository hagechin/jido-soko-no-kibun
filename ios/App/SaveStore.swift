import Foundation

/// セーブの保存先: Documents/saves/<key>.json（アトミック書き込み）。localStorage は消されることがあるので本体はこちら
final class SaveStore {
    private let dir: URL

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        dir = docs.appendingPathComponent("saves", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    private func url(for key: String) -> URL {
        let safe = key.replacingOccurrences(of: "[^A-Za-z0-9._-]", with: "_", options: .regularExpression)
        return dir.appendingPathComponent("\(safe).json")
    }

    func write(key: String, text: String) throws {
        try text.data(using: .utf8)?.write(to: url(for: key), options: [.atomic])
    }

    func read(key: String) -> String? {
        guard let data = try? Data(contentsOf: url(for: key)) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func delete(key: String) {
        try? FileManager.default.removeItem(at: url(for: key))
    }

    /// すべてのセーブを消す（UI テストの -resetSave 用）
    func deleteAll() {
        guard let items = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
        for u in items { try? FileManager.default.removeItem(at: u) }
    }
}
