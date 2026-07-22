#include "network_client.h"

#include "network_message.h"

#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>

namespace classicmmo
{
        namespace
        {

                using json = nlohmann::json;

                std::mutex g_log_mutex;

                void ClassicLog(const std::string &message)
                {
                        std::lock_guard<std::mutex> lock(g_log_mutex);

                        std::cout << message << std::endl;

                        std::ofstream file("classicmmo_network.log", std::ios::app);
                        if (file)
                        {
                                file << message << std::endl;
                        }
                }

                constexpr int kChatBubbleFrames = 180;
                constexpr std::size_t kMaxChatBubbleLength = 28;

                std::string ClampChatBubbleText(const std::string &text)
                {
                        if (text.size() <= kMaxChatBubbleLength)
                        {
                                return text;
                        }

                        return text.substr(0, kMaxChatBubbleLength - 3) + "...";
                }

                std::string NormalizeDirection(const std::string &direction)
                {
                        if (
                                direction == "up" ||
                                direction == "down" ||
                                direction == "left" ||
                                direction == "right")
                        {
                                return direction;
                        }

                        return "down";
                }

                std::string JsonString(
                        const json &message,
                        const char *key,
                        const std::string &fallback = "")
                {
                        if (!message.is_object())
                        {
                                return fallback;
                        }

                        const auto it = message.find(key);

                        if (it == message.end() || !it->is_string())
                        {
                                return fallback;
                        }

                        return it->get<std::string>();
                }

                int JsonInt(const json &message, const char *key, int fallback = 0)
                {
                        if (!message.is_object())
                        {
                                return fallback;
                        }

                        const auto it = message.find(key);

                        if (it == message.end() || !it->is_number_integer())
                        {
                                return fallback;
                        }

                        return it->get<int>();
                }

                bool ReadRemotePlayerFromJson(
                        const json &message,
                        const std::string &client_id_key,
                        RemotePlayerState &out_player)
                {
                        if (!message.is_object())
                        {
                                return false;
                        }

                        const std::string client_id = JsonString(message, client_id_key.c_str());
                        const std::string map_id = JsonString(message, "mapId");

                        if (client_id.empty() || map_id.empty())
                        {
                                return false;
                        }

                        // LUMNIA_LOGIN_SPRITE_GHOST_FIX
                        out_player.client_id = client_id;
                        out_player.character_id = JsonString(message, "characterId");
                        out_player.map_id = map_id;
                        out_player.x = JsonInt(message, "x", 0);
                        out_player.y = JsonInt(message, "y", 0);
                        out_player.direction = NormalizeDirection(JsonString(message, "direction", "down"));
                        out_player.sprite_name = JsonString(message, "spriteName");
                        out_player.sprite_index = JsonInt(message, "spriteIndex", 0);
                        out_player.player_name = JsonString(message, "playerName");

                        return true;
                }

#if defined(__EMSCRIPTEN__)
                EM_BOOL ClassicMMOOnWebSocketOpen(
                        int,
                        const EmscriptenWebSocketOpenEvent *,
                        void *user_data)
                {
                        static_cast<NetworkClient *>(user_data)->HandleWebSocketOpen();
                        return EM_TRUE;
                }

                EM_BOOL ClassicMMOOnWebSocketClose(
                        int,
                        const EmscriptenWebSocketCloseEvent *,
                        void *user_data)
                {
                        static_cast<NetworkClient *>(user_data)->HandleWebSocketClose();
                        return EM_TRUE;
                }

                EM_BOOL ClassicMMOOnWebSocketError(
                        int,
                        const EmscriptenWebSocketErrorEvent *,
                        void *user_data)
                {
                        static_cast<NetworkClient *>(user_data)->HandleWebSocketError();
                        return EM_TRUE;
                }

                EM_BOOL ClassicMMOOnWebSocketMessage(
                        int,
                        const EmscriptenWebSocketMessageEvent *event,
                        void *user_data)
                {
                        static_cast<NetworkClient *>(user_data)->HandleWebSocketMessage(
                                reinterpret_cast<const char *>(event->data),
                                event->numBytes,
                                event->isText != 0);

                        return EM_TRUE;
                }
#endif

        } // namespace

        NetworkClient::NetworkClient() = default;

        NetworkClient::~NetworkClient()
        {
                Disconnect();
        }

        bool NetworkClient::Connect(const std::string &server_url)
        {
                if (connected.load())
                {
                        return true;
                }

                url = server_url;

#if defined(CLASSICMMO_HAS_IXWEBSOCKET)
                socket = std::make_unique<ix::WebSocket>();
                socket->setUrl(url);

                socket->setOnMessageCallback([this](const ix::WebSocketMessagePtr &msg)
                                                                         {
                if (msg->type == ix::WebSocketMessageType::Open) {
                        connected.store(true);
                        ClassicLog("[ClassicMMO] Connected to " + url);
                        return;
                }

                if (msg->type == ix::WebSocketMessageType::Close) {
                        connected.store(false);
                        ClassicLog("[ClassicMMO] Connection closed");
                        return;
                }

                if (msg->type == ix::WebSocketMessageType::Error) {
                        connected.store(false);
                        ClassicLog("[ClassicMMO] WebSocket error: " + msg->errorInfo.reason);
                        return;
                }

                if (msg->type == ix::WebSocketMessageType::Message) {
                        HandleServerMessage(msg->str);
                } });

                socket->start();

                ClassicLog("[ClassicMMO] Connecting to " + url);

                return true;
#elif defined(__EMSCRIPTEN__)
                if (!emscripten_websocket_is_supported())
                {
                        ClassicLog("[ClassicMMO] Browser WebSocket is not supported");
                        url.clear();
                        return false;
                }

                EmscriptenWebSocketCreateAttributes attributes;
                emscripten_websocket_init_create_attributes(&attributes);

                attributes.url = url.c_str();
                attributes.protocols = nullptr;
                attributes.createOnMainThread = EM_TRUE;

                socket = emscripten_websocket_new(&attributes);

                if (socket <= 0)
                {
                        ClassicLog("[ClassicMMO] Browser WebSocket creation failed");
                        socket = 0;
                        url.clear();
                        return false;
                }

                emscripten_websocket_set_onopen_callback(socket, this, ClassicMMOOnWebSocketOpen);
                emscripten_websocket_set_onclose_callback(socket, this, ClassicMMOOnWebSocketClose);
                emscripten_websocket_set_onerror_callback(socket, this, ClassicMMOOnWebSocketError);
                emscripten_websocket_set_onmessage_callback(socket, this, ClassicMMOOnWebSocketMessage);

                ClassicLog("[ClassicMMO] Browser WebSocket connecting to " + url);

                return true;
#else
                ClassicLog("[ClassicMMO] Network support is not available in this build");
                url.clear();
                return false;
#endif
        }

        void NetworkClient::Disconnect()
        {
#if defined(CLASSICMMO_HAS_IXWEBSOCKET)
                if (socket)
                {
                        socket->stop();
                        socket.reset();
                }
#elif defined(__EMSCRIPTEN__)
                if (socket > 0)
                {
                        emscripten_websocket_close(socket, 1000, "ClassicMMO shutdown");
                        emscripten_websocket_delete(socket);
                        socket = 0;
                }
#endif

                if (connected.load())
                {
                        ClassicLog("[ClassicMMO] Disconnected from " + url);
                }

                connected.store(false);
                url.clear();

                {
                        std::lock_guard<std::mutex> lock(remote_players_mutex);
                        remote_players.clear();
                        local_client_id.clear();
                        local_character_id.clear();
                        local_player_name.clear();
                }
        }

        bool NetworkClient::IsConnected() const
        {
                return connected.load();
        }

        void NetworkClient::SendChat(const std::string &text)
        {
                if (!connected.load())
                {
                        return;
                }

                const auto message = NetworkMessage::MakeChatMessage(text);

#if defined(CLASSICMMO_HAS_IXWEBSOCKET)
                if (!socket)
                {
                        return;
                }

                socket->sendText(message);
#elif defined(__EMSCRIPTEN__)
                if (socket <= 0)
                {
                        return;
                }

                emscripten_websocket_send_utf8_text(socket, message.c_str());
#else
                return;
#endif

                ClassicLog("[ClassicMMO] Send chat: " + message);
        }

        void NetworkClient::SendPosition(
                const std::string &map_id,
                int x,
                int y,
                const std::string &direction,
                const std::string &sprite_name,
                int sprite_index,
                const std::string &player_name,
                const std::string &auth_token,
                const std::string &character_id,
                const std::string &game_mode)
        {
                if (!connected.load())
                {
                        return;
                }

                {
                        std::lock_guard<std::mutex> lock(remote_players_mutex);

                        if (!player_name.empty())
                        {
                                local_player_name = player_name;
                        }

                        if (!character_id.empty())
                        {
                                local_character_id = character_id;
                        }
                }

                auto message = NetworkMessage::MakePositionMessage(
                        map_id,
                        x,
                        y,
                        direction,
                        sprite_name,
                        sprite_index,
                        player_name);

                if (!auth_token.empty() || !character_id.empty() || !game_mode.empty())
                {
                        auto enriched_message = json::parse(message, nullptr, false);

                        if (!enriched_message.is_discarded() && enriched_message.is_object())
                        {
                                if (!auth_token.empty())
                                {
                                        enriched_message["authToken"] = auth_token;
                                }

                                if (!character_id.empty())
                                {
                                        enriched_message["characterId"] = character_id;
                                }

                                if (!game_mode.empty())
                                {
                                        enriched_message["gameMode"] = game_mode;
                                }

                                message = enriched_message.dump();
                        }
                }

#if defined(CLASSICMMO_HAS_IXWEBSOCKET)
                if (!socket)
                {
                        return;
                }

                socket->sendText(message);
#elif defined(__EMSCRIPTEN__)
                if (socket <= 0)
                {
                        return;
                }

                emscripten_websocket_send_utf8_text(socket, message.c_str());
#else
                return;
#endif

                ClassicLog(
                        "[ClassicMMO] Send position: map=" +
                        map_id +
                        " x=" + std::to_string(x) +
                        " y=" + std::to_string(y) +
                        " player=" + player_name +
                        " auth=" + std::string(auth_token.empty() ? "no" : "yes") +
                        " characterId=" + std::string(character_id.empty() ? "no" : "yes") +
                        " mode=" + game_mode);
        }

        std::vector<RemotePlayerState> NetworkClient::GetRemotePlayersSnapshot() const
        {
                std::lock_guard<std::mutex> lock(remote_players_mutex);

                std::vector<RemotePlayerState> snapshot;
                snapshot.reserve(remote_players.size());

                for (const auto &entry : remote_players)
                {
                        snapshot.push_back(entry.second);
                }

                return snapshot;
        }

        bool NetworkClient::ConsumeSpawnOverride(SpawnOverride &out_spawn)
        {
                std::lock_guard<std::mutex> lock(spawn_override_mutex);

                if (!has_spawn_override)
                {
                        return false;
                }

                out_spawn = pending_spawn_override;
                has_spawn_override = false;
                pending_spawn_override = SpawnOverride();

                return true;
        }

        void NetworkClient::HandleServerMessage(const std::string &raw_message)
        {
                const auto message = json::parse(raw_message, nullptr, false);

                if (message.is_discarded() || !message.is_object())
                {
                        ClassicLog("[ClassicMMO] Invalid server JSON: " + raw_message);
                        return;
                }

                const std::string type = JsonString(message, "type");

                if (type == "welcome")
                {
                        const std::string client_id = JsonString(message, "clientId");

                        {
                                std::lock_guard<std::mutex> lock(remote_players_mutex);
                                local_client_id = client_id;
                        }

                        ClassicLog("[ClassicMMO] Received welcome: " + raw_message);
                        return;
                }

                if (type == "state_snapshot")
                {
                        std::vector<RemotePlayerState> players;

                        if (message.contains("players") && message["players"].is_array())
                        {
                                for (const auto &player_json : message["players"])
                                {
                                        RemotePlayerState player;

                                        if (ReadRemotePlayerFromJson(player_json, "clientId", player))
                                        {
                                                players.push_back(player);
                                        }
                                }
                        }

                        ApplyStateSnapshot(players);

                        ClassicLog(
                                "[ClassicMMO] Applied state snapshot. Remote players: " +
                                std::to_string(players.size()));

                        return;
                }

                if (type == "player_joined")
                {
                        RemotePlayerState player;

                        if (ReadRemotePlayerFromJson(message, "clientId", player))
                        {
                                UpsertRemotePlayer(player);

                                ClassicLog(
                                        "[ClassicMMO] Remote player joined: " +
                                        player.client_id +
                                        " map=" + player.map_id +
                                        " x=" + std::to_string(player.x) +
                                        " y=" + std::to_string(player.y) +
                                        " dir=" + player.direction);
                        }
                        else
                        {
                                ClassicLog("[ClassicMMO] Invalid player_joined message: " + raw_message);
                        }

                        return;
                }

                if (type == "position")
                {
                        RemotePlayerState player;

                        if (ReadRemotePlayerFromJson(message, "from", player))
                        {
                                UpsertRemotePlayer(player);

                                ClassicLog(
                                        "[ClassicMMO] Remote position: " +
                                        player.client_id +
                                        " map=" + player.map_id +
                                        " x=" + std::to_string(player.x) +
                                        " y=" + std::to_string(player.y) +
                                        " dir=" + player.direction);
                        }
                        else
                        {
                                ClassicLog("[ClassicMMO] Invalid position message: " + raw_message);
                        }

                        return;
                }

                if (type == "spawn_override")
                {
                        SpawnOverride spawn;
                        spawn.spawn_key = JsonString(message, "spawnKey");
                        spawn.reason = JsonString(message, "reason");
                        spawn.map_id = JsonString(message, "mapId");
                        spawn.direction = JsonString(message, "direction");

                        // LUMNIA_CHARACTER_PERSISTENCE:
                        // o spawn também pode restaurar a aparência da conta.
                        spawn.sprite_name = JsonString(message, "spriteName");
                        spawn.sprite_index = JsonInt(message, "spriteIndex", 0);
                        spawn.character_id = JsonString(message, "characterId");

                        if (message.contains("x") && message["x"].is_number_integer())
                        {
                                spawn.x = message["x"].get<int>();
                        }

                        if (message.contains("y") && message["y"].is_number_integer())
                        {
                                spawn.y = message["y"].get<int>();
                        }

                        if (spawn.direction.empty())
                        {
                                spawn.direction = "down";
                        }

                        if (!spawn.map_id.empty())
                        {
                                if (!spawn.character_id.empty())
                                {
                                        std::lock_guard<std::mutex> remote_lock(remote_players_mutex);
                                        local_character_id = spawn.character_id;

                                        for (auto it = remote_players.begin(); it != remote_players.end();)
                                        {
                                                const bool same_character =
                                                        !local_character_id.empty() &&
                                                        it->second.character_id == local_character_id;

                                                if (same_character)
                                                {
                                                        it = remote_players.erase(it);
                                                }
                                                else
                                                {
                                                        ++it;
                                                }
                                        }
                                }

                                std::lock_guard<std::mutex> lock(spawn_override_mutex);
                                pending_spawn_override = spawn;
                                has_spawn_override = true;

                                ClassicLog(
                                        "[ClassicMMO] Received spawn_override: " +
                                        spawn.spawn_key +
                                        " map=" + spawn.map_id +
                                        " x=" + std::to_string(spawn.x) +
                                        " y=" + std::to_string(spawn.y) +
                                        " dir=" + spawn.direction);
                        }
                        else
                        {
                                ClassicLog("[ClassicMMO] Invalid spawn_override message: " + raw_message);
                        }

                        return;
                }

                if (type == "player_left")
                {
                        const std::string client_id = JsonString(message, "clientId");

                        if (!client_id.empty())
                        {
                                RemoveRemotePlayer(client_id);
                                ClassicLog("[ClassicMMO] Remote player left: " + client_id);
                        }

                        return;
                }

                if (type == "chat")
                {
                        const std::string from = JsonString(message, "from");
                        const std::string text = JsonString(message, "text");

                        if (!from.empty() && !text.empty())
                        {
                                ApplyRemoteChat(from, text);
                                ClassicLog("[ClassicMMO] Remote chat from " + from + ": " + text);
                        }

                        return;
                }

                ClassicLog("[ClassicMMO] Unknown server message: " + raw_message);
        }

        void NetworkClient::ApplyStateSnapshot(const std::vector<RemotePlayerState> &players)
        {
                std::lock_guard<std::mutex> lock(remote_players_mutex);

                remote_players.clear();

                for (const auto &player : players)
                {
                        const bool same_client =
                                !local_client_id.empty() &&
                                player.client_id == local_client_id;

                        const bool same_character =
                                !local_character_id.empty() &&
                                player.character_id == local_character_id;

                        if (same_client || same_character)
                        {
                                continue;
                        }

                        remote_players[player.client_id] = player;
                }
        }

        void NetworkClient::UpsertRemotePlayer(const RemotePlayerState &player)
        {
                std::lock_guard<std::mutex> lock(remote_players_mutex);

                const bool same_client =
                        !local_client_id.empty() &&
                        player.client_id == local_client_id;

                const bool same_character =
                        !local_character_id.empty() &&
                        player.character_id == local_character_id;

                if (same_client || same_character)
                {
                        remote_players.erase(player.client_id);
                        return;
                }

                const auto existing = remote_players.find(player.client_id);

                if (existing != remote_players.end())
                {
                        RemotePlayerState updated_player = player;
                        updated_player.chat_text = existing->second.chat_text;
                        updated_player.chat_timer = existing->second.chat_timer;

                        existing->second = updated_player;
                        return;
                }

                remote_players[player.client_id] = player;
        }

        void NetworkClient::RemoveRemotePlayer(const std::string &client_id)
        {
                std::lock_guard<std::mutex> lock(remote_players_mutex);
                remote_players.erase(client_id);
        }

        void NetworkClient::ApplyRemoteChat(const std::string &client_id, const std::string &text)
        {
                std::lock_guard<std::mutex> lock(remote_players_mutex);

                const auto existing = remote_players.find(client_id);

                if (existing == remote_players.end())
                {
                        return;
                }

                existing->second.chat_text = ClampChatBubbleText(text);
                existing->second.chat_timer = kChatBubbleFrames;
        }

        void NetworkClient::Update()
        {
                std::lock_guard<std::mutex> lock(remote_players_mutex);

                for (auto &entry : remote_players)
                {
                        RemotePlayerState &player = entry.second;

                        if (player.chat_timer > 0)
                        {
                                --player.chat_timer;

                                if (player.chat_timer <= 0)
                                {
                                        player.chat_text.clear();
                                }
                        }
                }
        }

#if defined(__EMSCRIPTEN__)
        void NetworkClient::HandleWebSocketOpen()
        {
                connected.store(true);
                ClassicLog("[ClassicMMO] Browser WebSocket connected to " + url);
        }

        void NetworkClient::HandleWebSocketClose()
        {
                connected.store(false);
                ClassicLog("[ClassicMMO] Browser WebSocket closed");
        }

        void NetworkClient::HandleWebSocketError()
        {
                connected.store(false);
                ClassicLog("[ClassicMMO] Browser WebSocket error");
        }

        void NetworkClient::HandleWebSocketMessage(const char *data, std::size_t size, bool is_text)
        {
                if (!is_text || !data || size == 0)
                {
                        ClassicLog("[ClassicMMO] Ignored non-text browser WebSocket message");
                        return;
                }

                HandleServerMessage(std::string(data, size));
        }
#endif

} // namespace classicmmo
