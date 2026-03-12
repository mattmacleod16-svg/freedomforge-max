import Foundation

/// API client for FreedomForge Dashboard API.
/// Handles authentication, JSON decoding, and SSE streaming.
class APIClient {
    static let shared = APIClient()

    private var baseURL = "http://localhost:9091"
    private var token = ""
    private let session: URLSession
    private let decoder = JSONDecoder.ff

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        config.waitsForConnectivity = true
        session = URLSession(configuration: config)
    }

    func configure(baseURL: String, token: String) {
        self.baseURL = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.token = token
    }

    // MARK: - REST

    func get<T: Decodable>(_ path: String) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard httpResponse.statusCode == 200 else {
            throw APIError.httpError(httpResponse.statusCode)
        }

        return try decoder.decode(T.self, from: data)
    }

    // MARK: - SSE Stream

    func sseStream(_ path: String) -> AsyncStream<SSEEvent> {
        AsyncStream { continuation in
            let task = Task {
                while !Task.isCancelled {
                    do {
                        guard let url = URL(string: baseURL + path) else {
                            try await Task.sleep(nanoseconds: 5_000_000_000)
                            continue
                        }

                        var request = URLRequest(url: url)
                        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                        if !token.isEmpty {
                            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                        }
                        request.timeoutInterval = 0 // No timeout for SSE

                        let (bytes, response) = try await session.bytes(for: request)

                        guard let httpResponse = response as? HTTPURLResponse,
                              httpResponse.statusCode == 200 else {
                            try await Task.sleep(nanoseconds: 5_000_000_000)
                            continue
                        }

                        var eventType = ""
                        var eventData = ""
                        var eventId: String?

                        for try await line in bytes.lines {
                            if Task.isCancelled { break }

                            if line.isEmpty {
                                // End of event
                                if !eventData.isEmpty {
                                    continuation.yield(SSEEvent(
                                        event: eventType.isEmpty ? "message" : eventType,
                                        data: eventData,
                                        id: eventId
                                    ))
                                }
                                eventType = ""
                                eventData = ""
                                eventId = nil
                                continue
                            }

                            if line.hasPrefix("event:") {
                                eventType = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                            } else if line.hasPrefix("data:") {
                                eventData = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                            } else if line.hasPrefix("id:") {
                                eventId = String(line.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                            }
                            // Ignore comment lines (starting with :)
                        }
                    } catch {
                        if Task.isCancelled { break }
                        // Reconnect after delay
                        try? await Task.sleep(nanoseconds: 5_000_000_000)
                    }
                }
                continuation.finish()
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }
}

// MARK: - Errors

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid server URL"
        case .invalidResponse: return "Invalid server response"
        case .httpError(let code): return "HTTP \(code)"
        }
    }
}

// MARK: - JSON Decoder

extension JSONDecoder {
    static var ff: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let timestamp = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: timestamp / 1000)
            }
            if let dateString = try? container.decode(String.self) {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = formatter.date(from: dateString) { return date }
                formatter.formatOptions = [.withInternetDateTime]
                if let date = formatter.date(from: dateString) { return date }
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Cannot decode date")
        }
        return decoder
    }
}
