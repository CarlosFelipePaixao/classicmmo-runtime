#ifndef CLASSICMMO_NETWORK_CLIENT_H
#define CLASSICMMO_NETWORK_CLIENT_H

#if defined(CLASSICMMO_HAS_IXWEBSOCKET)
#include <ixwebsocket/IXWebSocket.h>
#endif

#if defined(__EMSCRIPTEN__)
#include <emscripten/html5.h>
#include <emscripten/websocket.h>
#endif

#include <atomic>
#include <cstddef>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace classicmmo
{

        struct RemotePlayerState
        {
                std::string client_id;
                std::string map_id;
                int x = 0;
                int y = 0;
                std::string direction = "down";
                std::string sprite_name;
                int sprite_index = 0;
                std::string player_name;
                std::string chat_text;
                int chat_timer = 0;
        };

        struct SpawnOverride
        {
                std::string spawn_key;
                std::string reason;
                std::string map_id;
                int x = 0;
                int y = 0;
                std::string direction = "down";
        };

        class NetworkClient
        {
        public:
                NetworkClient();
                ~NetworkClient();

                bool Connect(const std::string &server_url);
                void Disconnect();

                bool IsConnected() const;

                void SendChat(const std::string &text);

                void SendPosition(
                        const std::string &map_id,
                        int x,
                        int y,
                        const std::string &direction,
                        const std::string &sprite_name,
                        int sprite_index,
                        const std::string &player_name);

                std::vector<RemotePlayerState> GetRemotePlayersSnapshot() const;

                bool ConsumeSpawnOverride(SpawnOverride &out_spawn);

                void Update();

#if defined(__EMSCRIPTEN__)
                void HandleWebSocketOpen();
                void HandleWebSocketClose();
                void HandleWebSocketError();
                void HandleWebSocketMessage(const char *data, std::size_t size, bool is_text);
#endif

        private:
                void HandleServerMessage(const std::string &raw_message);
                void ApplyStateSnapshot(const std::vector<RemotePlayerState> &players);
                void UpsertRemotePlayer(const RemotePlayerState &player);
                void RemoveRemotePlayer(const std::string &client_id);
                void ApplyRemoteChat(const std::string &client_id, const std::string &text);

#if defined(CLASSICMMO_HAS_IXWEBSOCKET)
                std::unique_ptr<ix::WebSocket> socket;
#elif defined(__EMSCRIPTEN__)
                EMSCRIPTEN_WEBSOCKET_T socket = 0;
#endif

                std::atomic_bool connected{false};
                std::string url;

                mutable std::mutex remote_players_mutex;
                std::unordered_map<std::string, RemotePlayerState> remote_players;

                mutable std::mutex spawn_override_mutex;
                bool has_spawn_override = false;
                SpawnOverride pending_spawn_override;
        };

} // namespace classicmmo

#endif
