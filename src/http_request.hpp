#pragma once

#include <stdexcept>
#include <string>
#include <nlohmann/json.hpp>

namespace orders3 {

struct HttpRequestError : std::invalid_argument {
    std::string field;
    explicit HttpRequestError(const std::string& name)
        : std::invalid_argument("INVALID_HTTP_REQUEST: " + name), field(name) {}

    nlohmann::json as_json() const {
        return {{"code", "INVALID_HTTP_REQUEST"}, {"field", field},
                {"retryable", false}};
    }
};

// Separate transport data from local operation envelopes and stored records.
// Sign and send this exact body_bytes string; never serialize the descriptor.
// has_body=false means the transport must omit the request body entirely.
struct PreparedHttpRequest {
    std::string method;
    std::string path;
    std::string query;
    bool has_body;
    std::string body_bytes;
};

inline PreparedHttpRequest prepare_http_request(const nlohmann::json& descriptor) {
    if (!descriptor.is_object() || descriptor.size() != 4)
        throw HttpRequestError("descriptor");
    for (const auto* key : {"method", "path", "query"}) {
        if (!descriptor.contains(key) || !descriptor.at(key).is_string())
            throw HttpRequestError(key);
    }
    if (!descriptor.contains("body")) throw HttpRequestError("body");
    const auto method = descriptor.at("method").get<std::string>();
    const auto path = descriptor.at("path").get<std::string>();
    const auto query = descriptor.at("query").get<std::string>();
    // Only the GET/POST methods in the current local exchange contract.
    if (method != "GET" && method != "POST") throw HttpRequestError("method");
    const auto unsafe = [](const std::string& value) {
        for (const unsigned char c : value)
            if (c <= 0x20 || c >= 0x7f) return true;
        return false;
    };
    if (path.empty() || path[0] != '/' || path.compare(0, 2, "//") == 0 ||
        path.find_first_of("?#\\") != std::string::npos || unsafe(path))
        throw HttpRequestError("path");
    if ((!query.empty() && query[0] == '?') ||
        query.find('#') != std::string::npos || unsafe(query))
        throw HttpRequestError("query");
    const auto& body = descriptor.at("body");
    if ((!body.is_null() && !body.is_object()) ||
        (method == "GET" && !body.is_null())) throw HttpRequestError("body");
    std::string bytes;
    if (!body.is_null()) {
        try {
            // Reject non-JSON values that dump() could silently turn into null.
            const auto validate = [&](const auto& self, const nlohmann::json& value) -> void {
                if (value.is_binary() || value.is_discarded() || value.is_number_float())
                    throw HttpRequestError("body");
                if (value.is_structured())
                    for (const auto& child : value) self(self, child);
            };
            validate(validate, body);
            bytes = body.dump(); // strict UTF-8; decimal business fields use strings
        } catch (const nlohmann::json::exception&) {
            throw HttpRequestError("body");
        }
    }
    return {method, path, query, !body.is_null(), bytes};
}

} // namespace orders3
