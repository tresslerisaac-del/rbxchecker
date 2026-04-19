import discord
from discord.ext import commands
from discord import app_commands
import requests
import itertools
import asyncio
import os
import time
import random
import string
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
PANEL_CHANNEL_ID = int(os.getenv("CHANNEL_ID", "1495409305317277829"))

OWNER_ID = 1487316298969911409
ALLOWED_ROLE_ID = 1495408646266556416       # Can use the dropdown
FAST_ROLE_ID = 1495408761819500777          # 30s cooldown instead of 60s

# Cooldowns (seconds)
COOLDOWN_DEFAULT = 60
COOLDOWN_FAST_ROLE = 30
COOLDOWN_OWNER = 5

intents = discord.Intents.default()
intents.message_content = True
intents.guilds = True
intents.members = True

bot = commands.Bot(command_prefix="!", intents=intents)

bot_enabled = True
panel_message_id = None
user_cooldowns = {}  # {user_id: last_used_timestamp}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_cooldown(member: discord.Member) -> int:
    if member.id == OWNER_ID:
        return COOLDOWN_OWNER
    role_ids = [r.id for r in member.roles]
    if FAST_ROLE_ID in role_ids:
        return COOLDOWN_FAST_ROLE
    return COOLDOWN_DEFAULT


def is_on_cooldown(member: discord.Member) -> float:
    """Returns seconds remaining, or 0 if not on cooldown."""
    last = user_cooldowns.get(member.id, 0)
    cd = get_cooldown(member)
    elapsed = time.time() - last
    remaining = cd - elapsed
    return remaining if remaining > 0 else 0


def set_cooldown(member: discord.Member):
    user_cooldowns[member.id] = time.time()


CHARS_LETTERS = string.ascii_lowercase
CHARS_ALL = string.ascii_lowercase + string.digits


def generate_candidates(length: int, count: int = 50) -> list:
    """Generate random candidates of given length."""
    pool = list(itertools.product(CHARS_ALL, repeat=length))
    random.shuffle(pool)
    return [''.join(c) for c in pool[:min(count, len(pool))]]


async def check_username(username: str) -> bool:
    """Returns True if username appears available on Roblox."""
    try:
        loop = asyncio.get_event_loop()
        def _req():
            return requests.get(
                "https://auth.roblox.com/v1/usernames/validate",
                params={"username": username, "birthday": "2000-01-01"},
                timeout=5
            )
        r = await loop.run_in_executor(None, _req)
        data = r.json()
        return data.get("code") == 0
    except Exception:
        return False


async def find_available(length: int, max_results: int = 10) -> list:
    """Scan random combos until we have max_results available names."""
    found = []
    candidates = generate_candidates(length, count=500)
    for name in candidates:
        if len(found) >= max_results:
            break
        if await check_username(name):
            found.append(name)
        await asyncio.sleep(1.2)
    return found


def build_panel_embed() -> discord.Embed:
    embed = discord.Embed(
        title="🎮 Roblox Username Checker",
        description=(
            "Select a username length below to search for available Roblox usernames.\n"
            "Results will be sent to your **DMs** and a private channel.\n\n"
            "**Lengths:**\n"
            "• `3L` — 3 character usernames\n"
            "• `4L` — 4 character usernames\n"
            "• `5L` — 5 character usernames\n\n"
            f"⚠️ You must have <@&{ALLOWED_ROLE_ID}> to use this."
        ),
        color=0x5865F2
    )
    embed.set_footer(text="Results include letters & numbers • Max 10 per search")
    return embed


# ─── Dropdown ─────────────────────────────────────────────────────────────────

class LengthSelect(discord.ui.Select):
    def __init__(self):
        options = [
            discord.SelectOption(label="3 Letter Usernames", value="3", emoji="🔵"),
            discord.SelectOption(label="4 Letter Usernames", value="4", emoji="🟣"),
            discord.SelectOption(label="5 Letter Usernames", value="5", emoji="🟠"),
        ]
        super().__init__(
            placeholder="Select username length...",
            min_values=1,
            max_values=1,
            options=options,
            custom_id="rbx_length_select"
        )

    async def callback(self, interaction: discord.Interaction):
        global bot_enabled
        member = interaction.user

        # Check if bot is enabled
        if not bot_enabled and member.id != OWNER_ID:
            await interaction.response.send_message(
                "❌ The username checker is currently **disabled**.", ephemeral=True
            )
            return

        # Check role
        role_ids = [r.id for r in member.roles]
        if ALLOWED_ROLE_ID not in role_ids and member.id != OWNER_ID:
            await interaction.response.send_message(
                f"❌ You need <@&{ALLOWED_ROLE_ID}> to use this.", ephemeral=True
            )
            return

        # Check cooldown
        remaining = is_on_cooldown(member)
        if remaining > 0:
            await interaction.response.send_message(
                f"⏳ You're on cooldown! Please wait **{remaining:.1f}s**.", ephemeral=True
            )
            return

        length = int(self.values[0])
        set_cooldown(member)

        await interaction.response.send_message(
            f"🔍 Searching for **{length}-character** usernames... This may take a minute. Check your DMs!",
            ephemeral=True
        )

        # Run search
        results = await find_available(length, max_results=10)

        # ── DM the user ──
        result_lines = "\n".join([f"• `{n}`" for n in results]) if results else "No available usernames found in this scan. Try again!"
        dm_embed = discord.Embed(
            title=f"🎮 {length}-Character Roblox Usernames",
            description=result_lines,
            color=0x57F287 if results else 0xED4245
        )
        dm_embed.set_footer(text="These may become taken quickly — act fast!")

        try:
            await member.send(embed=dm_embed)
        except discord.Forbidden:
            pass  # DMs closed

        # ── Create private temp channel ──
        guild = interaction.guild
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            member: discord.PermissionOverwrite(read_messages=True, send_messages=False),
            guild.me: discord.PermissionOverwrite(read_messages=True, send_messages=True)
        }

        # Try to place it under the same category as panel channel
        panel_ch = guild.get_channel(PANEL_CHANNEL_ID)
        category = panel_ch.category if panel_ch else None

        try:
            private_channel = await guild.create_text_channel(
                name=f"{member.name}s-private-tagz",
                overwrites=overwrites,
                category=category,
                topic=f"Private results for {member.name} • Auto-deletes in 1 hour"
            )

            ch_embed = discord.Embed(
                title=f"🔐 {member.display_name}'s Private Tagz",
                description=result_lines,
                color=0x5865F2
            )
            ch_embed.set_footer(text="This channel auto-deletes in 1 hour.")
            await private_channel.send(f"{member.mention}", embed=ch_embed)

            # Schedule deletion after 1 hour
            async def delete_after():
                await asyncio.sleep(3600)
                try:
                    await private_channel.delete(reason="Auto-delete after 1 hour")
                except Exception:
                    pass

            asyncio.create_task(delete_after())

        except discord.Forbidden:
            pass  # No permissions to create channels


class PanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(LengthSelect())


# ─── Bot Events ───────────────────────────────────────────────────────────────

@bot.event
async def on_ready():
    print(f"✅ Logged in as {bot.user} ({bot.user.id})")
    bot.add_view(PanelView())  # re-register persistent view
    await bot.tree.sync()
    print("✅ Slash commands synced.")


# ─── Owner / Admin Commands ───────────────────────────────────────────────────

def is_owner_or_admin():
    async def predicate(ctx):
        if ctx.author.id == OWNER_ID:
            return True
        if ctx.author.guild_permissions.administrator:
            return True
        return False
    return commands.check(predicate)


@bot.command(name="on")
@is_owner_or_admin()
async def bot_on(ctx):
    global bot_enabled
    bot_enabled = True
    await ctx.send("✅ Bot **enabled**. Everyone with the role can use the dropdown.")


@bot.command(name="off")
@is_owner_or_admin()
async def bot_off(ctx):
    global bot_enabled
    bot_enabled = False
    await ctx.send("🔴 Bot **disabled**. Only the owner can use the dropdown.")


@bot.command(name="resend")
@is_owner_or_admin()
async def resend_panel(ctx):
    """Delete old panel(s) and send a fresh one."""
    global panel_message_id
    channel = bot.get_channel(PANEL_CHANNEL_ID)
    if channel is None:
        await ctx.send("❌ Panel channel not found.")
        return

    # Delete old panel message if tracked
    if panel_message_id:
        try:
            old_msg = await channel.fetch_message(panel_message_id)
            await old_msg.delete()
        except Exception:
            pass

    # Also sweep for any bot messages in that channel
    async for msg in channel.history(limit=50):
        if msg.author == bot.user:
            try:
                await msg.delete()
            except Exception:
                pass

    # Send fresh panel
    view = PanelView()
    sent = await channel.send(embed=build_panel_embed(), view=view)
    panel_message_id = sent.id
    await ctx.send(f"✅ Panel resent in <#{PANEL_CHANNEL_ID}>.")


@bot.command(name="sendpanel")
@is_owner_or_admin()
async def send_panel(ctx):
    """Send the panel to the configured channel (first time setup)."""
    global panel_message_id
    channel = bot.get_channel(PANEL_CHANNEL_ID)
    if channel is None:
        await ctx.send("❌ Panel channel not found. Check CHANNEL_ID in your env.")
        return
    view = PanelView()
    sent = await channel.send(embed=build_panel_embed(), view=view)
    panel_message_id = sent.id
    await ctx.send(f"✅ Panel sent to <#{PANEL_CHANNEL_ID}>.")


@bot_on.error
@bot_off.error
@resend_panel.error
@send_panel.error
async def admin_error(ctx, error):
    if isinstance(error, commands.CheckFailure):
        await ctx.send("❌ You don't have permission to use this command.")


# ─── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    bot.run(TOKEN)
