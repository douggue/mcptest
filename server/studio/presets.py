"""Built-in styles. Same shape as a learned profile: a style the editor applies, standing elements, rules and a brief
for the AI, and which planner suits the footage ("speech" follows the transcript, "story" looks at the picture)."""
from __future__ import annotations

GREEN, RED, YELLOW, CYAN, MAGENTA = "#08de0a", "#f51c08", "#f7f00c", "#0fe9f3", "#f729ea"


def _rules(kind: str, *texts: str) -> list[dict]:
    return [{"id": f"b{kind[0]}{i}", "kind": kind, "text": t, "source": "built-in", "on": True} for i, t in enumerate(texts)]


BUILTIN: list[dict] = [
    {
        "id": "builtin-storyline", "name": "Storyline", "builtin": True, "planner": "story",
        "summary": "Security-camera, dashcam and phone clips: a square picture over a blurred copy, a title that stays up, boxed captions with speaker tags, and freeze-frame spotlights on the key moments.",
        "style": {
            "width": 1080, "height": 1920, "fps": 30,
            "frame": {"mode": "panel", "shape": "square", "width": 100, "aspect": 1.0, "y": 50, "bg": "blur"},
            "captions": {"visible": True, "preset": "box", "font": "Poppins", "size": 84, "color": "#ffffff", "highlight": "#22dd31",
                         "position": 69, "uppercase": False, "maxWords": 4, "emoji": False},
            "look": {"preset": "none", "bw": False, "vignette": False, "progressBar": False, "saturation": 1.25, "contrast": 1.05},
            "brand": {"font": "Poppins", "accent": "#22dd31"},
        },
        "elements": [{"type": "label", "style": "plain", "color": "#22dd31", "text": "title", "at": "start", "duration": "all", "dy": -40, "scale": 0.9, "animation": "fade"}],
        "brief": ("A short that tells what happened in raw footage. The title is the hook and stays on screen the whole time, with its key word in green. "
                  "Captions are short chunks of two to four words in a black box, each tagged with who is speaking or acting. "
                  "About two seconds in, freeze for one second with a spotlight on the main subject; freeze again (1.3 seconds) right after the key event, "
                  "and once more when a second subject first appears. Skip dead time with fast-forward at about 2.5x. No flashes."),
        "rules": _rules("writing",
                        "Write the title as a claim that makes the viewer wait for the payoff, with one key word marked for colour.",
                        "Do not invent narration or dialogue for real people; at most one or two short lines for the main subject.",
                        "Write visible actions as short captions in asterisks, such as *WIPES OUT*.",
                        "Follow the beats intro, build-up, event, aftermath, payoff.")
                 + _rules("editing",
                          "Put a caption on screen from the first frame and change it every 0.4 to 1 second.",
                          "Use the spotlight only on a freeze-frame, never on moving footage.",
                          "Keep the clip as short as the story allows."),
    },
    {
        "id": "builtin-kindness", "name": "Kindness story", "builtin": True, "planner": "story",
        "summary": "A 3:4 story with a twist: typed narration lines, a freeze with a red circle and arrow, colour flashes on the turns, and a heart at the end.",
        "style": {
            "width": 1080, "height": 1440, "fps": 60,
            "frame": {"mode": "full", "shape": "rounded", "width": 100, "aspect": 1.0, "y": 50, "bg": "blur"},
            "captions": {"visible": False, "preset": "typeon", "font": "Poppins", "size": 58, "color": "#ffffff", "highlight": "#f43c3f",
                         "position": 58, "uppercase": True, "maxWords": 5, "emoji": True},
            "look": {"preset": "none", "bw": False, "vignette": False, "progressBar": False, "saturation": 1.18, "contrast": 1.05, "brightness": 1.1},
            "brand": {"font": "Poppins", "accent": "#f43c3f", "watermarkY": 90, "watermarkSize": 50, "watermarkOpacity": 0.6},
        },
        "elements": [{"type": "heart", "text": "", "at": "end", "duration": 2.2, "dy": -4}],
        "brief": ("A feel-good story told in on-screen narration, not speech. Lines are white capitals, one or two rows, typed on, with the key phrase in colour: "
                  "red for emphasis, green for a good outcome, yellow for the hook, magenta for setbacks, cyan for neutral detail. "
                  "Early on (around one to two seconds in) flash white, freeze for about 1.2 seconds, and call out the person with a red circle, a red arrow and a short yellow or red label. "
                  "Flash red on the setback and green on the turn. Use a dip to black between scenes. Fast-forward dull stretches at 2.5 to 3x and slow the payoff to about 0.7x. "
                  "End on the heart, about two seconds before the end, with the moral line."),
        "rules": _rules("writing",
                        "Open on a question in the first frame, such as WOULD YOU HAVE {STOPPED FOR HIM?}.",
                        "Follow the twist structure: hook question, struggle, others do not help, a misdirect about the helper, BUT THEN..., payoff, moral with a call to action.",
                        "Keep each line to one to seven words; about half the captions are a single line.",
                        "Describe only what is visible, and speak of bystanders as a group, never singling one out.",
                        "Put emotional phrases in asterisks.")
                 + _rules("editing",
                          "Show one narration caption every three to five seconds and leave gaps between them.",
                          "Do not show a story caption during a freeze.",
                          "Callout labels are yellow or red, never green."),
    },
    {
        "id": "builtin-clean", "name": "Clean story", "builtin": True, "planner": "story",
        "summary": "A brighter 3:4 story told in short quoted neon labels, with a name tag, glowing callouts on moving footage and colour flashes on the beats. No freezes.",
        "style": {
            "width": 1080, "height": 1440, "fps": 60,
            "frame": {"mode": "full", "shape": "rounded", "width": 100, "aspect": 1.0, "y": 50, "bg": "blur"},
            "captions": {"visible": False, "preset": "neon", "font": "Poppins", "size": 60, "color": "#ffffff", "highlight": GREEN,
                         "position": 80, "uppercase": True, "maxWords": 4, "emoji": True},
            "look": {"preset": "none", "bw": False, "vignette": False, "progressBar": False, "saturation": 1.28, "contrast": 1.07, "brightness": 1.06},
            "brand": {"font": "Poppins", "accent": GREEN, "watermarkY": 85.5, "watermarkSize": 64, "watermarkOpacity": 0.4},
        },
        "elements": [],
        "brief": ("A story told in 9 to 12 short labels of one to four words, in capitals inside white quote marks, each on for half a second to two seconds near the bottom of the frame. "
                  f"Colour carries meaning: green {GREEN} for good and the payoff, red {RED} for bad, yellow {YELLOW} for people watching, cyan {CYAN} for neutral, magenta {MAGENTA} for a repeated letdown. "
                  "Start with a name tag over the main person. Between 1.4 and 2 seconds in, flash white and call out the subject with a circle, an arrow and a green label. "
                  "Add two to four more circles or arrows on moving footage. Flash a colour on four to eight beats: yellow for watching, red for the low point, green for the turn. "
                  "Never freeze. Fast-forward dead time at about 2.7x. End with a white flash and a final green label with a small heart emoji."),
        "rules": _rules("writing",
                        "Follow the label arc: hook, struggle, indifference, misdirect, BUT THEN, the act, others join, final label.",
                        "Plant a question in the first two seconds that is only answered at BUT THEN.",
                        "Describe only what is visible and do not shame individual bystanders.")
                 + _rules("editing",
                          "Keep the whole video between 16 and 22 seconds.",
                          "Place labels where they do not cover the subject, and never on a face."),
    },
    {
        "id": "builtin-neon", "name": "Neon story", "builtin": True, "planner": "story",
        "summary": "A caption-only 3:4 story in multi-colour neon text: a spotlight and name tag early, a freeze on the twist with an arrow, and a heart at the end. Original sound, no music.",
        "style": {
            "width": 1080, "height": 1440, "fps": 30,
            "frame": {"mode": "full", "shape": "rounded", "width": 100, "aspect": 1.0, "y": 50, "bg": "blur"},
            "captions": {"visible": False, "preset": "neon", "font": "Poppins", "size": 66, "color": "#ffffff", "highlight": "#fade0a",
                         "position": 48, "uppercase": True, "maxWords": 4, "emoji": False},
            "look": {"preset": "none", "bw": False, "vignette": False, "progressBar": False, "saturation": 1.15, "contrast": 1.08, "brightness": 1.1},
            "brand": {"font": "Poppins", "accent": "#fade0a", "watermarkY": 95.5},
        },
        "elements": [{"type": "emoji", "text": "❤️‍🩹", "at": "end", "duration": 0.9, "dy": 0}],
        "brief": ("No narrator: the captions tell the story, and something is always on screen, changing every one to two seconds. "
                  "Story lines are two centred rows around the middle of the frame: white words, then one or two words in neon (yellow #fade0a, cyan #2bf3ee, green #4efa66, magenta #f982f8, red #fa464e). "
                  "Around 2.3 seconds in, put a spotlight on the hidden person with a name tag, and clear it with a white flash. "
                  "At the twist, freeze for 1.5 seconds with a spotlight and a red arrow at the face and a short typed caption, then flash white. "
                  "Slow the reveal to about 0.55x and run the rest slightly slow (0.9x). End with the bandaged heart."),
        "rules": _rules("writing",
                        "Open from the first frame on the premise, telling the viewer what the subject does not know.",
                        "Write short actions in asterisks, such as *FED UP*.",
                        "Say only what the footage supports, and flag any relationship you are assuming.",
                        "Dialogue lines may be written to fit the story; keep them to one short line beside the speaker.")
                 + _rules("editing",
                          "Keep the original sound and add no music unless asked.",
                          "Keep the whole video between 14 and 27 seconds."),
    },
    {
        "id": "builtin-brand", "name": "Brand ad", "builtin": True, "planner": "speech",
        "summary": "Turns a landscape TV advert into a short: channel header, a two-line multi-colour title that stays up, the ad in a very rounded box on black, and one or two word captions coloured per speaker.",
        "style": {
            "width": 1080, "height": 1920, "fps": 60,
            "frame": {"mode": "panel", "shape": "squircle", "width": 90, "aspect": 0.957, "y": 55.6, "bg": "black"},
            "captions": {"visible": True, "preset": "shadow", "font": "Poppins", "size": 58, "color": "#ffffff", "highlight": "#fafe04",
                         "position": 67, "uppercase": True, "noPunct": True, "maxWords": 2, "emoji": False, "lead": 0.15},
            "look": {"preset": "none", "bw": False, "vignette": False, "progressBar": False, "saturation": 1.12, "contrast": 1.02},
            "brand": {"font": "Poppins", "accent": "#fafe04"},
            "header": {"name": "Your channel", "handle": "@yourchannel", "avatar": "", "verified": True, "y": 11},
        },
        "elements": [{"type": "label", "style": "flat", "color": "#fafe04", "text": "title", "at": "start", "duration": "all", "dy": -26.7, "scale": 0.97, "animation": "none"}],
        "brief": ("The advert plays in the box with its own sound; add no music or sound effects. The title is two lines in capitals, on screen unchanged for the whole video, "
                  "white with two or three phrases in colour (the brand name is always one of them): yellow #fafe04, cyan #04fafd, green #07fc1b, red #fc0000, magenta #fc63ec, orange #f7a534. "
                  "Captions are one or two words, popping in slightly before each word, one colour per speaker; the voice-over slogan is white. "
                  "The first frame must be lit and already show a caption. Punch in on the product now and then."),
        "rules": _rules("writing",
                        "Write the title as a bold claim that praises the brand's marketing and makes the viewer want to check it, such as THIS {BRAND} AD IS / ACTUALLY {GENIUS}.",
                        "Caption the dialogue, the visible actions in asterisks, and the closing slogan.",
                        "Write X2 for repeats; keep question marks and apostrophes; use no full stops, commas or emoji.",
                        "Leave out any line you cannot transcribe reliably and correct misheard brand names.")
                 + _rules("editing", "Trim dark or fading frames at the start and keep the brand's end card."),
    },
    {
        "id": "builtin-narrated", "name": "Narrated story", "builtin": True, "planner": "speech", "draft": True,
        "summary": "A narrated 9:16 story with your own voiceover: glowing serif captions in the centre, a new shot every couple of seconds, and dips between shots. Your skill marks this style's edit as not yet approved; only its script rules are.",
        "style": {
            "width": 1080, "height": 1920, "fps": 60,
            "frame": {"mode": "full", "shape": "rounded", "width": 100, "aspect": 1.0, "y": 50, "bg": "blur"},
            "captions": {"visible": True, "preset": "glow", "font": "Cinzel", "size": 68, "color": "#ffffff", "highlight": "#00ddff",
                         "position": 50, "uppercase": True, "maxWords": 3, "emoji": False, "lead": 0.06},
            "look": {"preset": "none", "bw": False, "vignette": False, "progressBar": False, "brightness": 1.08, "contrast": 1.06},
            "brand": {"font": "Cinzel", "accent": "#00ddff", "watermarkY": 77, "watermarkOpacity": 0.3},
        },
        "elements": [],
        "brief": ("A narrator tells the setup, then the real clip delivers the punchline. Captions are one to three words in the dead centre, on screen almost all the time, "
                  "cycling cyan and green clause by clause with red on the punchline. Change the shot every two seconds or so and keep every shot moving with a slow push-in. "
                  "Use a dip between most shots and no white flashes. Leave a wordless tail of one and a half to four seconds after the punchline."),
        "rules": _rules("writing",
                        "Make line one the whole premise, strange situation first, and line two an open loop.",
                        "Keep the script to 60 to 70 words.",
                        "Stay mysterious: tease what is coming, never describe it, and let key actions play without narration.",
                        "Pivot almost every sentence on but or so; follow a long setup sentence with a short punch.",
                        "Use past tense for backstory and present tense for what is on screen; repeat the name instead of he or she.",
                        "No spoilers, no outro and no summary.")
                 + _rules("editing", "Alternate the narrator and the clip's own sound, and never let the bed drop to silence."),
    },
]


def get(pid: str) -> dict | None:
    return next((p for p in BUILTIN if p["id"] == pid), None)
