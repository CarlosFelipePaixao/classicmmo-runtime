#include "classicmmo_runtime.h"

#include "game_player.h"
#include "game_vehicle.h"
#include "main_data.h"

#if defined(CLASSICMMO_HAS_IXWEBSOCKET)
#include <ixwebsocket/IXNetSystem.h>
#endif

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#endif

#include <cerrno>
#include <climits>
#include <cstdlib>
#include <iostream>
#include <string>

#if defined(__EMSCRIPTEN__)
EM_JS(char *, ClassicMMOGetQueryParam, (const char *key_ptr), {
        if (typeof window === 'undefined' || !window.location) {
                return 0;
        }

        var key = UTF8ToString(key_ptr);
        var params = new URLSearchParams(window.location.search);
        var value = params.get(key);

        if (!value) {
                return 0;
        }

        var length = lengthBytesUTF8(value) + 1;
        var ptr = _malloc(length);
        stringToUTF8(value, ptr, length);
        return ptr;
});
#endif

namespace classicmmo
{
	namespace
	{

		NetworkClient g_network_client;
		bool g_initialized = false;
		bool g_sent_test_chat = false;

		int g_last_map_id = -1;
		int g_last_x = -1;
		int g_last_y = -1;
		int g_last_direction = -1;

		std::string DirectionToString(int direction)
		{
			switch (direction)
			{
			case 0:
				return "up";
			case 1:
				return "right";
			case 2:
				return "down";
			case 3:
				return "left";
			default:
				return "down";
			}
		}

#if defined(__EMSCRIPTEN__)
                std::string GetWebQueryParamName(const char *name)
                {
                        const std::string env_name = name ? name : "";

                        if (env_name == "CLASSICMMO_SERVER_URL")
                        {
                                return "server";
                        }

                        if (env_name == "CLASSICMMO_PLAYER_NAME")
                        {
                                return "name";
                        }

                        if (env_name == "CLASSICMMO_SPRITE_NAME")
                        {
                                return "sprite";
                        }

                        if (env_name == "CLASSICMMO_SPRITE_INDEX")
                        {
                                return "spriteIndex";
                        }

                        if (env_name == "CLASSICMMO_TEST_CHAT_TEXT")
                        {
                                return "chat";
                        }

                        
                        if (env_name == "CLASSICMMO_AUTH_TOKEN")
                        {
                                return "token";
                        }

                        if (env_name == "CLASSICMMO_CHARACTER_ID")
                        {
                                return "characterId";
                        }

                        if (env_name == "CLASSICMMO_GAME_MODE")
                        {
                                return "mode";
                        }

return "";
                }

                std::string GetWebQueryParamString(const char *name)
                {
                        const std::string param_name = GetWebQueryParamName(name);

                        if (param_name.empty())
                        {
                                return "";
                        }

                        char *value = ClassicMMOGetQueryParam(param_name.c_str());

                        if (!value)
                        {
                                return "";
                        }

                        const std::string result(value);
                        std::free(value);

                        return result;
                }
#endif

                std::string GetEnvString(const char *name)
                {
                        const char *value = std::getenv(name);

                        if (value && value[0] != '\0')
                        {
                                return std::string(value);
                        }

#if defined(__EMSCRIPTEN__)
                        const std::string query_value = GetWebQueryParamString(name);

                        if (!query_value.empty())
                        {
                                return query_value;
                        }

                        const std::string env_name = name ? name : "";

                        if (env_name == "CLASSICMMO_SERVER_URL")
                        {
                                return "ws://3.134.107.141:7777";
                        }
#endif

                        return "";
                }

                int GetEnvInt(const char *name, int fallback)
                {
                        const std::string value_string = GetEnvString(name);

                        if (value_string.empty())
                        {
                                return fallback;
                        }

                        const char *value = value_string.c_str();
                        char *end = nullptr;
                        errno = 0;

                        const long parsed = std::strtol(value, &end, 10);

                        if (end == value || *end != '\0' || errno == ERANGE || parsed < INT_MIN || parsed > INT_MAX)
                        {
                                return fallback;
                        }

                        return static_cast<int>(parsed);
                }

		void SendDevTestChatIfConfigured(bool allow_send)
		{
			if (!allow_send || g_sent_test_chat)
			{
				return;
			}

			const std::string text = GetEnvString("CLASSICMMO_TEST_CHAT_TEXT");

			if (text.empty())
			{
				return;
			}

			g_network_client.SendChat(text);
			g_sent_test_chat = true;
		}

		void ResetLastPlayerPosition()
		{
			g_last_map_id = -1;
			g_last_x = -1;
			g_last_y = -1;
			g_last_direction = -1;
		}

		int ParseMapId(const std::string &map_id)
		{
		        if (map_id.empty())
		        {
		                return -1;
		        }

		        char *end = nullptr;
		        errno = 0;

		        const long parsed = std::strtol(map_id.c_str(), &end, 10);

		        if (end == map_id.c_str() || *end != 0 || errno == ERANGE || parsed <= 0 || parsed > INT_MAX)
		        {
		                return -1;
		        }

		        return static_cast<int>(parsed);
		}

		void ApplyPendingSpawnOverride()
		{
		        if (!Main_Data::game_player)
		        {
		                return;
		        }

		        SpawnOverride spawn;

		        if (!g_network_client.ConsumeSpawnOverride(spawn))
		        {
		                return;
		        }

		        const int map_id = ParseMapId(spawn.map_id);

		        if (map_id <= 0)
		        {
		                std::cout << "[ClassicMMO] Invalid spawn_override mapId: " << spawn.map_id << std::endl;
		                return;
		        }

		        if (Main_Data::game_player->GetMapId() == map_id)
		        {
		                Main_Data::game_player->MoveTo(map_id, spawn.x, spawn.y);
		        }
		        else
		        {
		                Main_Data::game_player->ReserveTeleport(
		                        map_id,
		                        spawn.x,
		                        spawn.y,
		                        -1,
		                        TeleportTarget::eSkillTeleport);
		        }

		        ResetLastPlayerPosition();

		        std::cout
		                << "[ClassicMMO] Applied spawn_override: "
		                << spawn.spawn_key
		                << " map=" << map_id
		                << " x=" << spawn.x
		                << " y=" << spawn.y
		                << " dir=" << spawn.direction
		                << std::endl;
		}

		void SendPlayerPositionIfChanged()
		{
			if (!g_network_client.IsConnected())
			{
				ResetLastPlayerPosition();
				return;
			}

			if (!Main_Data::game_player)
			{
				return;
			}

			const int map_id = Main_Data::game_player->GetMapId();

			if (map_id <= 0)
			{
				return;
			}

			const int x = Main_Data::game_player->GetX();
			const int y = Main_Data::game_player->GetY();
			const int direction = Main_Data::game_player->GetDirection();

			const bool had_previous_position = g_last_map_id != -1;

			if (
				map_id == g_last_map_id &&
				x == g_last_x &&
				y == g_last_y &&
				direction == g_last_direction)
			{
				return;
			}

			g_last_map_id = map_id;
			g_last_x = x;
			g_last_y = y;
			g_last_direction = direction;

			std::string sprite_name = Main_Data::game_player->GetSpriteName();
			int sprite_index = Main_Data::game_player->GetSpriteIndex();

			const std::string sprite_name_override = GetEnvString("CLASSICMMO_SPRITE_NAME");

			if (!sprite_name_override.empty())
			{
				sprite_name = sprite_name_override;
			}

			sprite_index = GetEnvInt("CLASSICMMO_SPRITE_INDEX", sprite_index);

			if (Main_Data::game_player->InVehicle())

			{

			        auto *vehicle = Main_Data::game_player->GetVehicle();


			        if (vehicle)

			        {

			                const auto vehicle_sprite_name = vehicle->GetOrigSpriteName();


			                if (!vehicle_sprite_name.empty())

			                {

			                        sprite_name = std::string(

			                                vehicle_sprite_name.data(),

			                                vehicle_sprite_name.size());

			                }


			                sprite_index = vehicle->GetOrigSpriteIndex();

			        }

			}


			std::string player_name = GetEnvString("CLASSICMMO_PLAYER_NAME");

			if (player_name.empty())
			{
				player_name = "Player";
			}

			const std::string auth_token = GetEnvString("CLASSICMMO_AUTH_TOKEN");
			const std::string character_id = GetEnvString("CLASSICMMO_CHARACTER_ID");
			const std::string game_mode = GetEnvString("CLASSICMMO_GAME_MODE");

			g_network_client.SendPosition(
			        std::to_string(map_id),
			        x,
			        y,
			        DirectionToString(direction),
			        sprite_name,
			        sprite_index,
			        player_name,
			        auth_token,
			        character_id,
			        game_mode);

			SendDevTestChatIfConfigured(had_previous_position);
		}

	} // namespace

        void ClassicMMORuntime::Initialize()
        {
                if (g_initialized)
                {
                        return;
                }

                g_initialized = true;

#if defined(CLASSICMMO_HAS_IXWEBSOCKET)
                ix::initNetSystem();
#endif

                ResetLastPlayerPosition();
                g_sent_test_chat = false;

                std::cout << "[ClassicMMO] Runtime initialized" << std::endl;

                const std::string server_url = GetEnvString("CLASSICMMO_SERVER_URL");

                if (!server_url.empty())
                {
                        std::cout << "[ClassicMMO] Network server: " << server_url << std::endl;
                        g_network_client.Connect(server_url);
                }
                else
                {
                        std::cout << "[ClassicMMO] Network disabled. Set CLASSICMMO_SERVER_URL to connect." << std::endl;
                }
        }

	void ClassicMMORuntime::Shutdown()
	{
		if (!g_initialized)
		{
			return;
		}

		g_network_client.Disconnect();
#if defined(CLASSICMMO_HAS_IXWEBSOCKET)
                ix::uninitNetSystem();
#endif
		ResetLastPlayerPosition();
		g_sent_test_chat = false;

		g_initialized = false;

		std::cout << "[ClassicMMO] Runtime shutdown" << std::endl;
	}

	void ClassicMMORuntime::Update()
	{
		if (!g_initialized)
		{
			return;
		}

		g_network_client.Update();
		ApplyPendingSpawnOverride();
		SendPlayerPositionIfChanged();
	}

	bool ClassicMMORuntime::IsInitialized()
	{
		return g_initialized;
	}

	NetworkClient &ClassicMMORuntime::GetNetworkClient()
	{
		return g_network_client;
	}

} // namespace classicmmo