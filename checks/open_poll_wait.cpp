#include "../src/open_poll_wait.hpp"
#include "../src/storage_schema.hpp"
#include <iostream>
#include <vector>
using nlohmann::json;
int count = 0;
void check(bool ok) {
    ++count;
    if (!ok) throw std::runtime_error("Open poll check " + std::to_string(count));
}
int main() {
    for (bool long_side : {true, false}) {
        const json record = {{"record_id", "r1"}, {"id", "9007199254740993"},
            {"tag", "pending open orders"}, {"Contract", "BTC_USDT"},
            {"side", long_side ? "Open Long" : "Open Short"},
            {"position_side", long_side ? "LONG" : "SHORT"},
            {"target_key", long_side ? "BTC_USDT:LONG" : "BTC_USDT:SHORT"},
            {"terminal_result", nullptr}, {"original_status", nullptr},
            {"signal_price", "100.00"}, {"execution", {{"filled_quantity", nullptr},
                {"remaining_working_quantity", nullptr}, {"evidence_complete", false}}},
            {"close_assignment", {{"state", "not_eligible"}, {"task_id", nullptr}}}};
        json response = {{"code", 0}, {"data", {{"order", {
            {"id", record["id"]}, {"contract", "BTC_USDT"},
            {"amount", long_side ? "2" : "-2"}, {"original_status", 1},
            {"status_code", "pending"}, {"pos_margin_mode", "cross"},
            {"position_mode", "dual_plus"}}}}}};
        const auto original_response = response;
        auto verify_preserved = [&](const json& result) {
            for (const auto* key : {"record_id", "id", "tag", "Contract", "side",
                     "position_side", "target_key", "signal_price", "execution",
                     "terminal_result", "close_assignment"})
                check(result.at(key) == record.at(key));
            check(result.at("next_action") == "poll");
            auto store = orders3::make_empty_store();
            store[0]["pending open orders"].push_back(result);
            check(orders3::parse_store(store.dump()) == store);
        };
        const char* codes[] = {"pending", "ongoing", "partial"};
        const char* states[] = {"waiting_activation", "tracking", "partial"};
        for (int status = 1; status <= 3; ++status) {
            response["data"]["order"]["original_status"] = status;
            response["data"]["order"]["status_code"] = codes[status - 1];
            const auto copy = response;
            auto result = orders3::with_open_poll_wait(record, response);
            check(result["original_status"] == status);
            check(result["local_state"] == states[status - 1]);
            check(result["last_error"].is_null());
            check(response == copy);
            verify_preserved(result);
            if (status == 3) {
                check(result["partial_observed"] == true);
                auto failed = orders3::with_open_poll_wait(result, nullptr);
                check(failed["partial_observed"] == true);
                check(failed["original_status"] == 3);
                verify_preserved(failed);
                result["execution"]["filled_quantity"] = "1";
                check(orders3::with_open_poll_wait(result, response)["execution"] == result["execution"]);
            }
        }
        response = original_response;
        auto reject_response = [&](const json& bad) {
            const auto result = orders3::with_open_poll_wait(record, bad);
            check(result["local_state"] == "reconciling");
            check(result["original_status"].is_null());
            check(result["last_detail_response"] == bad);
            verify_preserved(result);
        };
        for (const json& bad : std::vector<json>{nullptr, 1, json::array(), json::object(),
                {{"code", 1}}, {{"code", 0.0}}, {{"code", 0}, {"data", nullptr}}})
            reject_response(bad);
        for (const auto* key : {"id", "contract", "amount", "original_status", "status_code",
                               "pos_margin_mode", "position_mode"}) {
            auto bad = response;
            bad["data"]["order"].erase(key);
            reject_response(bad);
            for (const json& value : std::vector<json>{nullptr, true, json::array(), "wrong"}) {
                bad["data"]["order"][key] = value;
                reject_response(bad);
            }
        }
        for (const json& value : std::vector<json>{0, 4, 5, 99, 1.0, "1", 18446744073709551615ull}) {
            auto bad = response;
            bad["data"]["order"]["original_status"] = value;
            reject_response(bad);
        }
        for (const auto* value : {"0", "-0", "+2", "2.0", "2e1", " 2", "-", ""}) {
            auto bad = response;
            bad["data"]["order"]["amount"] = value;
            reject_response(bad);
        }
        for (const auto* key : {"side_label", "position_side_output", "reduce_only"}) {
            auto bad = response;
            bad["data"]["order"][key] = true;
            reject_response(bad);
        }
        auto misleading = response;
        misleading["data"]["order"]["status"] = "finished";
        misleading["data"]["order"]["finished_at"] = "1790054385";
        check(orders3::with_open_poll_wait(record, misleading)["local_state"] == "waiting_activation");
        for (const auto* key : {"record_id", "id", "Contract", "side", "position_side", "target_key", "tag", "close_assignment"}) {
            auto bad = record;
            bad.erase(key);
            bool rejected = false;
            try { orders3::with_open_poll_wait(bad, response); }
            catch (const std::runtime_error&) { rejected = true; }
            check(rejected);
        }
    }
    std::cout << "Open poll wait: " << count << " checks passed\n";
}
