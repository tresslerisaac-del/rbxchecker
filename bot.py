import discord
from discord.ext import commands
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
ALLOWED_ROLE_ID = 1495408646266556416
FAST_ROLE_ID = 1495408761819500777

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
user_cooldowns = {}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_cooldown(member: discord.Member) -> int:
    if member.id == OWNER_ID:
        return COOLDOWN_OWNER
    role_ids = [r.id for r in member.roles]
    if FAST_ROLE_ID in role_ids:
        return COOLDOWN_FAST_ROLE
    return COOLDOWN_DEFAULT


def is_on_cooldown(member: discord.Member) -> float:
    last = user_cooldowns.get(member.id, 0)
    cd = get_cooldown(member)
    elapsed = time.time() - last
    remaining = cd - elapsed
    return remaining if remaining > 0 else 0


def set_cooldown(member: discord.Member):
    user_cooldowns[member.id] = time.time()


CHARS_ALL = string.ascii_lowercase + string.digits


def generate_candidates(length: int, count: int = 500) -> list:
    pool = list(itertools.product(CHARS_ALL, repeat=length))
    random.shuffle(pool)
    return [''.join(c) for c in pool[:min(count, len(pool))]]


async def check_username(username: str) -> tuple:
    """
    Returns (is_available: bool, raw_code: int, error: str|None)
    code 0 = available, 1 = taken, 2 = filtered/inappropriate
    """
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
        code = data.get("code", -1)
        return (code == 0, code, None)
    except Exception as e:
        return (False, -1, str(e))


async def find_available(length: int, max_results: int = 10) -> tuple:
    """
    Returns (found: list, checked: int, errors: int, last_code: int)
    """
    found = []
    candidates = generate_candidates(length, count=500)
    checked = 0
    errors = 0
    last_code = -1

    for name in candidates:
        if len(found) >= max_results:
            break
        available, code, err = await check_username(name)
        checked += 1
        last_code = code
        if err:
            errors += 1
        elif available:
            found.append(name)
        await asyncio.sleep(1.2)

    return found, checked, errors, last_code


async def dm_user(member: discord.Member, embed: discord.Embed) -> bool:
    """Attempt to DM the user. Returns True if successful."""
    try:
        await member.send(embed=embed)
        return True
    except discord.Forbidden:
        return False
    except Exception:
        return False


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

        if not bot_enabled and member.id != OWNER_ID:
            await interaction.response.send_message(
                "❌ The username checker is currently **disabled**.", ephemeral=True
            )
            return

        role_ids = [r.id for r in member.roles]
        if ALLOWED_ROLE_ID not in role_ids and member.id != OWNER_ID:
            await interaction.response.send_message(
                f"❌ You need <@&{ALLOWED_ROLE_ID}> to use this.", ephemeral=True
            )
            return

        remaining = is_on_cooldown(member)
        if remaining > 0:
            await interaction.response.send_message(
                f"⏳ You're on cooldown! Please wait **{remaining:.1f}s**.", ephemeral=True
            )
            return

        length = int(self.values[0])
        set_cooldown(member)

        await interaction.response.send_message(
            f"🔍 Searching for **{length}-character** usernames... This may take a few minutes. Check your DMs!",
            ephemeral=True
        )

        found, checked, errors, last_code = await find_available(length, max_results=10)

        # ── Build result embed ──
        if found:
            result_lines = "\n".join([f"• `{n}`" for n in found])
            color = 0x57F287
            title = f"✅ {length}-Character Roblox Usernames Found!"
        else:
            result_lines = (
                f"No available usernames found after checking **{checked}** combinations.\n\n"
                f"Last API code: `{last_code}` | Errors: `{errors}`\n\n"
                f"**Code meanings:** `0` = available, `1` = taken, `2` = filtered, `-1` = request failed\n\n"
                "Try again later or ask the owner to run `!apidebug`."
            )
            color = 0xED4245
            title = f"❌ No {length}-Character Usernames Found"

        result_embed = discord.Embed(title=title, description=result_lines, color=color)
        result_embed.add_field(name="Checked", value=str(checked), inline=True)
        result_embed.add_field(name="Found", value=str(len(found)), inline=True)
        result_embed.add_field(name="API Errors", value=str(errors), inline=True)
        result_embed.set_footer(text="These may become taken quickly — act fast!")

        # ── DM the user ──
        dm_sent = await dm_user(member, result_embed)

        # ── Create private temp channel ──
        guild = interaction.guild
        overwrites = {
            guild.default_role: discord.PermissionOverwrite(read_messages=False),
            member: discord.PermissionOverwrite(read_messages=True, send_messages=False),
            guild.me: discord.PermissionOverwrite(read_messages=True, send_messages=True)
        }

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
            ch_embed.add_field(name="Checked", value=str(checked), inline=True)
            ch_embed.add_field(name="Found", value=str(len(found)), inline=True)
            ch_embed.add_field(name="API Errors", value=str(errors), inline=True)
            ch_embed.set_footer(text="This channel auto-deletes in 1 hour.")

            dm_status = "✅ DM sent" if dm_sent else "❌ DM failed (DMs may be closed)"
            await private_channel.send(
                f"{member.mention} • {dm_status}",
                embed=ch_embed
            )

            async def delete_after():
                await asyncio.sleep(3600)
                try:
                    await private_channel.delete(reason="Auto-delete after 1 hour")
                except Exception:
                    pass

            asyncio.create_task(delete_after())

        except discord.Forbidden:
            pass


class PanelView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(LengthSelect())


# ─── Bot Events ───────────────────────────────────────────────────────────────

@bot.event
async def on_ready():
    print(f"✅ Logged in as {bot.user} ({bot.user.id})")
    bot.add_view(PanelView())
    print("✅ Persistent view registered.")


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
    await ctx.send("✅ Bot **enabled**.")


@bot.command(name="off")
@is_owner_or_admin()
async def bot_off(ctx):
    global bot_enabled
    bot_enabled = False
    await ctx.send("🔴 Bot **disabled**. Only the owner can use the dropdown.")


@bot.command(name="resend")
@is_owner_or_admin()
async def resend_panel(ctx):
    global panel_message_id
    channel = bot.get_channel(PANEL_CHANNEL_ID)
    if channel is None:
        await ctx.send("❌ Panel channel not found.")
        return

    if panel_message_id:
        try:
            old_msg = await channel.fetch_message(panel_message_id)
            await old_msg.delete()
        except Exception:
            pass

    async for msg in channel.history(limit=50):
        if msg.author == bot.user:
            try:
                await msg.delete()
            except Exception:
                pass

    view = PanelView()
    sent = await channel.send(embed=build_panel_embed(), view=view)
    panel_message_id = sent.id
    await ctx.send(f"✅ Panel resent in <#{PANEL_CHANNEL_ID}>.")


@bot.command(name="sendpanel")
@is_owner_or_admin()
async def send_panel(ctx):
    global panel_message_id
    channel = bot.get_channel(PANEL_CHANNEL_ID)
    if channel is None:
        await ctx.send("❌ Panel channel not found. Check CHANNEL_ID in your env.")
        return
    view = PanelView()
    sent = await channel.send(embed=build_panel_embed(), view=view)
    panel_message_id = sent.id
    await ctx.send(f"✅ Panel sent to <#{PANEL_CHANNEL_ID}>.")


@bot.command(name="apidebug")
@is_owner_or_admin()
async def api_debug(ctx):
    """Test the Roblox API and DM the result to the caller."""
    test_names = ["zzz", "testxyz99", "a1b"]
    lines = []

    for name in test_names:
        available, code, err = await check_username(name)
        if err:
            lines.append(f"`{name}` → ❌ Error: `{err}`")
        else:
            status = "✅ Available" if available else "❌ Taken/Filtered"
            lines.append(f"`{name}` → {status} (code `{code}`)")
        await asyncio.sleep(1.2)

    description = (
        "\n".join(lines) + "\n\n"
        "**Code meanings:**\n"
        "`0` = available\n`1` = taken\n`2` = filtered\n`-1` = request failed\n\n"
        "If you're seeing `-1` errors, Railway may be blocking requests to Roblox."
    )

    embed = discord.Embed(
        title="🔧 Roblox API Debug",
        description=description,
        color=0xFEE75C
    )

    await ctx.send(embed=embed)
    await dm_user(ctx.author, embed)


@bot.command(name="status")
@is_owner_or_admin()
async def bot_status(ctx):
    embed = discord.Embed(title="📊 Bot Status", color=0x5865F2)
    embed.add_field(name="Enabled", value="✅ Yes" if bot_enabled else "🔴 No", inline=True)
    embed.add_field(name="Active Cooldowns Tracked", value=str(len(user_cooldowns)), inline=True)
    await ctx.send(embed=embed)


@bot_on.error
@bot_off.error
@resend_panel.error
@send_panel.error
@api_debug.error
@bot_status.error
async def admin_error(ctx, error):
    if isinstance(error, commands.CheckFailure):
        await ctx.send("❌ You don't have permission to use this command.")


# ─── Run ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    bot.run(TOKEN)
