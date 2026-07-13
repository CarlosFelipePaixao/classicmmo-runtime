#include "remote_character.h"

#include <algorithm>
#include <cstdlib>

namespace classicmmo
{
    namespace
    {

        constexpr int kTilePixels = 16;

        // Movimento remoto:
        // - normal: 2 px/frame, parecido com o movimento do RPG Maker.
        // - atrasado: 4 px/frame, para recuperar pacotes que chegam em rajada.
        constexpr int kBaseVisualPixelsPerFrame = 2;
        constexpr int kCatchUpVisualPixelsPerFrame = 4;

        // Permite acumular alguns tiles de atraso antes de considerar teleport/lag pesado.
        // Isso evita "pulos" quando chegam 2 pacotes de movimento muito próximos.
        constexpr int kMaxBufferedVisualOffset = kTilePixels * 4;

        // Troca o frame da perna a cada 2 updates.
        constexpr int kWalkingFrameTicks = 2;

        int MoveOffsetTowardZero(int value)
        {
            const int speed =
                std::abs(value) > kTilePixels
                    ? kCatchUpVisualPixelsPerFrame
                    : kBaseVisualPixelsPerFrame;

            if (value > 0)
            {
                return std::max(0, value - speed);
            }

            if (value < 0)
            {
                return std::min(0, value + speed);
            }

            return 0;
        }

    } // namespace

    RemoteCharacter::RemoteCharacter() : RemoteCharacterBase(Game_Character::Event)
    {
        SetThrough(true);
        SetLayer(lcf::rpg::EventPage::Layers_same);
        SetSpriteHidden(false);
        SetIdleAnimationFrame();
    }

    void RemoteCharacter::ApplyNetworkState(
        int map_id,
        int x,
        int y,
        int direction,
        const std::string &sprite_name,
        int sprite_index,
        const std::string &new_player_name,
        const std::string &new_chat_text)
    {
        SetThrough(true);

        player_name = new_player_name;
        chat_text = new_chat_text;

        if (!sprite_name.empty())
        {
            SetSpriteGraphic(sprite_name, sprite_index);
        }

        if (!has_spawned || GetMapId() != map_id)
        {
            SetMapId(map_id);
            SetX(x);
            SetY(y);
            SetDirection(direction);
            SetFacing(direction);
            ClearVisualOffset();
            SetIdleAnimationFrame();
            has_spawned = true;
            return;
        }

        // Importante:
        // SyncClassicMMORemotePlayers chama ApplyNetworkState todo update.
        // Se o servidor ainda está guardando o mesmo x/y, não podemos limpar o offset,
        // senão a interpolação visual é cancelada e o personagem teleporta.
        if (GetX() == x && GetY() == y)
        {
            SetDirection(direction);
            SetFacing(direction);

            if (!IsVisuallyMoving())
            {
                SetIdleAnimationFrame();
            }

            return;
        }

        const int old_x = GetX();
        const int old_y = GetY();

        const int dx = x - old_x;
        const int dy = y - old_y;

        SetMapId(map_id);
        SetX(x);
        SetY(y);
        SetDirection(direction);
        SetFacing(direction);

        const int distance = std::abs(dx) + std::abs(dy);

        if (distance == 1)
        {
            const bool was_idle = !IsVisuallyMoving();

            visual_offset_x += (old_x - x) * kTilePixels;
            visual_offset_y += (old_y - y) * kTilePixels;

            if (
                std::abs(visual_offset_x) > kMaxBufferedVisualOffset ||
                std::abs(visual_offset_y) > kMaxBufferedVisualOffset)
            {
                ClearVisualOffset();
                SetIdleAnimationFrame();
                return;
            }

            if (was_idle)
            {
                walking_anim_tick = 0;
            }

            SetWalkingAnimationFrame();
            return;
        }

        // Mudança grande demais: troca de mapa, correção, lag ou teleport real.
        ClearVisualOffset();
        SetIdleAnimationFrame();
    }

    void RemoteCharacter::UpdateVisualInterpolation()
    {
        if (!IsVisuallyMoving())
        {
            SetIdleAnimationFrame();
            return;
        }

        ++walking_anim_tick;
        SetWalkingAnimationFrame();

        visual_offset_x = MoveOffsetTowardZero(visual_offset_x);
        visual_offset_y = MoveOffsetTowardZero(visual_offset_y);

        if (!IsVisuallyMoving())
        {
            SetIdleAnimationFrame();
        }
    }

    int RemoteCharacter::GetVisualOffsetX() const
    {
        return visual_offset_x;
    }

    int RemoteCharacter::GetVisualOffsetY() const
    {
        return visual_offset_y;
    }

    const std::string &RemoteCharacter::GetPlayerName() const
    {
        return player_name;
    }

    const std::string &RemoteCharacter::GetChatText() const
    {
        return chat_text;
    }
    
    void RemoteCharacter::ClearVisualOffset()
    {
        visual_offset_x = 0;
        visual_offset_y = 0;
        walking_anim_tick = 0;
    }

    void RemoteCharacter::SetIdleAnimationFrame()
    {
        SetAnimFrame(lcf::rpg::EventPage::Frame_middle);
    }

    void RemoteCharacter::SetWalkingAnimationFrame()
    {
        const int phase = (walking_anim_tick / kWalkingFrameTicks) % 4;

        switch (phase)
        {
        case 0:
            SetAnimFrame(lcf::rpg::EventPage::Frame_left);
            break;
        case 1:
            SetAnimFrame(lcf::rpg::EventPage::Frame_middle);
            break;
        case 2:
            SetAnimFrame(lcf::rpg::EventPage::Frame_right);
            break;
        default:
            SetAnimFrame(lcf::rpg::EventPage::Frame_middle);
            break;
        }
    }

    bool RemoteCharacter::IsVisuallyMoving() const
    {
        return visual_offset_x != 0 || visual_offset_y != 0;
    }

    void RemoteCharacter::UpdateNextMovementAction()
    {
        // Remote characters are driven by network state, not local movement AI.
    }

} // namespace classicmmo