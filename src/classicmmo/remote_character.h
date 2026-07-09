#ifndef CLASSICMMO_REMOTE_CHARACTER_H
#define CLASSICMMO_REMOTE_CHARACTER_H

#include "game_character.h"

#include <lcf/rpg/savemapeventbase.h>

#include <string>

namespace classicmmo
{

    using RemoteCharacterBase = Game_CharacterDataStorage<lcf::rpg::SaveMapEventBase>;

    class RemoteCharacter final : public RemoteCharacterBase
    {
    public:
        RemoteCharacter();

        void ApplyNetworkState(
            int map_id,
            int x,
            int y,
            int direction,
            const std::string &sprite_name,
            int sprite_index,
            const std::string &player_name);

        void UpdateVisualInterpolation();

        int GetVisualOffsetX() const;
        int GetVisualOffsetY() const;

        const std::string &GetPlayerName() const;

        void UpdateNextMovementAction() override;

    private:
        int visual_offset_x = 0;
        int visual_offset_y = 0;

        bool has_spawned = false;

        int walking_anim_tick = 0;
        std::string player_name;

        void ClearVisualOffset();
        void SetIdleAnimationFrame();
        void SetWalkingAnimationFrame();
        bool IsVisuallyMoving() const;
    };

} // namespace classicmmo

#endif