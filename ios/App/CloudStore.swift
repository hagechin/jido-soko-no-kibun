import Foundation

/// iCloud キー値ストア（NSUbiquitousKeyValueStore）にセーブを 1 本だけ置く（SPEC-iOS §3、I6）。
/// 1 キー 1MB・全体 1MB の制限があるので zlib で圧縮して入れる。iCloud にサインインしていなければ available = false
final class CloudStore {
    static let dataKey = "save.v1"
    static let savedAtKey = "save.v1.savedAt"
    private let kv = NSUbiquitousKeyValueStore.default

    var available: Bool { FileManager.default.ubiquityIdentityToken != nil }

    func synchronize() { kv.synchronize() }

    func read() -> (text: String, savedAt: Double)? {
        guard let data = kv.data(forKey: Self.dataKey), let text = Self.unpack(data) else { return nil }
        return (text, kv.double(forKey: Self.savedAtKey))
    }

    /// 返り値: 書けたか（サイズ超過などで false）
    func write(text: String, savedAt: Double) -> Bool {
        guard let data = Self.pack(text), data.count < 900_000 else { return false }
        kv.set(data, forKey: Self.dataKey)
        kv.set(savedAt, forKey: Self.savedAtKey)
        return kv.synchronize()
    }

    func clear() {
        kv.removeObject(forKey: Self.dataKey)
        kv.removeObject(forKey: Self.savedAtKey)
        kv.synchronize()
    }

    static func pack(_ text: String) -> Data? {
        guard let raw = text.data(using: .utf8) else { return nil }
        return try? (raw as NSData).compressed(using: .zlib) as Data
    }

    static func unpack(_ data: Data) -> String? {
        guard let raw = try? (data as NSData).decompressed(using: .zlib) as Data else { return nil }
        return String(data: raw, encoding: .utf8)
    }
}
