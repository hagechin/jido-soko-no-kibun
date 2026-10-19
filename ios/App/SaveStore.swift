import Foundation

/// セーブの保存先: Library/Application Support/saves/<key>.json（アトミック書き込み）。localStorage は消されることがあるので本体はこちら。
/// 1.0 では Documents/saves にあったが、1.0.1 で Documents をファイル App に見せる（UIFileSharingEnabled）ようにしたので、
/// 本体のセーブは見えない場所へ移した（うっかり消されない）。初回起動で古い場所から移す
final class SaveStore {
    private let dir: URL

    init() {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        dir = support.appendingPathComponent("saves", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        migrateFromDocuments()
    }

    /// 1.0 の保存先（Documents/saves）に残っているセーブを新しい場所へ移す（新しい場所に同名が無いものだけ）
    private func migrateFromDocuments() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let old = docs.appendingPathComponent("saves", isDirectory: true)
        guard let items = try? FileManager.default.contentsOfDirectory(at: old, includingPropertiesForKeys: nil) else { return }
        for u in items where u.pathExtension == "json" {
            let dest = dir.appendingPathComponent(u.lastPathComponent)
            if FileManager.default.fileExists(atPath: dest.path) { continue }
            try? FileManager.default.moveItem(at: u, to: dest)
        }
        // 空になったら古いフォルダを消す（ファイル App に空の saves を見せない）
        if let rest = try? FileManager.default.contentsOfDirectory(at: old, includingPropertiesForKeys: nil), rest.isEmpty {
            try? FileManager.default.removeItem(at: old)
        }
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

    /// 書き出したセーブをファイル App（このiPhone内 › 箱庭！DS）に置く。Documents 直下。置いたファイル名を返す
    static func writeToDocuments(name: String, text: String) throws -> String {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let safe = name.replacingOccurrences(of: "/", with: "_")
        try text.write(to: docs.appendingPathComponent(safe), atomically: true, encoding: .utf8)
        return safe
    }
}
