"""The web app's plain-language story text, ported from frontend/src/lib.ts (describeStory, metricLine), so the
Quest panel reads exactly like the web panel. Keep in step with lib.ts if the wording there changes."""
import re
from datetime import date

_MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def _d(iso):
    y, m, d = (int(x) for x in iso[:10].split("-"))
    return date(y, m, d)


def format_date(iso):
    """'2026-10-12' -> '12 Oct 2026' (formatDate)."""
    d = _d(iso)
    return f"{d.day} {_MONTHS[d.month - 1]} {d.year}"


def format_date_short(iso):
    """'2026-10-12' -> '12 Oct' (formatDateShort)."""
    d = _d(iso)
    return f"{d.day} {_MONTHS[d.month - 1]}"


def js_num(v):
    """A number the way JS `${v}` prints it: 8 -> '8', 2.6 -> '2.6'."""
    return str(int(v)) if float(v).is_integer() else repr(float(v))


def pct(v):
    return f"{v:.1f}%"


def km_fmt(v):
    return f"{round(v)} km²" if v >= 100 else f"{v:.1f} km²"


def metric_line(s):
    when = f"{format_date_short(s['period']['start'])} – {format_date(s['period']['end'])}"
    if s["change_type"] == "earthquake":
        return f"Up to {s['metric']['value']:.1f} m of ground motion · {when}"
    return f"{js_num(s['metric']['value'])} {s['metric']['unit']} · {when}"


def describe_story(s):
    ser = s.get("series") or []
    first = ser[0] if ser else None
    last = ser[-1] if ser else None
    metric = s["metric"]

    if s["change_type"] == "earthquake":
        m = re.search(r"magnitude\s+([\d.]+)", s["headline"], re.I)
        mag = m.group(1) if m else None
        day = f" on {format_date(s['event_date'])}" if s.get("event_date") else ""
        m = re.search(r"differ by about ([\d.]+) m", s["summary"])
        span = m.group(1) if m else None
        m = re.search(r"([\d.]+) colour cycles", s["summary"])
        fringes = m.group(1) if m else None
        m = re.search(r"magnitude ([\d., and]+) aftershocks", " ".join(s.get("causes", [])))
        after = m.group(1) if m else None
        out = [
            f"{f'A magnitude {mag} earthquake' if mag else 'An earthquake'} struck here{day}. NISAR flew over twice, on "
            f"{format_date_short(s['period']['start'])} and {format_date_short(s['period']['end'])}, so the two passes sit either side of the shock.",
            f"Putting them together shows the ground moved by up to {metric['value']:.1f} m along the satellite's line of sight."
            + (f" Across the map the two extremes are about {span} m apart." if span else ""),
            "That is a lot. Radar can pick up movements of a few centimetres"
            + (f": each of the {fringes} colour cycles on the picture is only about 12 cm" if fringes else "")
            + f", so a metre or more is large. The picture covers about {round(s['area_km2']):,} km² around the earthquake, measured from space.",
        ]
        if after:
            out.append(f"Aftershocks of magnitude {after} fell in the same 12 days, so the map shows all of them together.")
        return out

    if s["change_type"] == "fire":
        m = re.search(r"another ([\d.]+) km\S* is possibly burned", s["summary"])
        possible = m.group(1) if m else None
        peak = max(ser, key=lambda p: p["value"]) if ser else None
        out = [
            f"A fire burned part of this area. Radar picked up about {js_num(metric['value'])} km² of ground that is likely burned"
            + (f", and another {possible} km² that is possibly burned" if possible else "")
            + f", compared with {format_date_short(s['period']['start'])}, before the fire."
        ]
        if peak and peak["value"] > 3 * metric["value"]:
            out.append(f"Later passes read much higher, up to {km_fmt(peak['value'])} on {format_date_short(peak['date'])}. "
                       f"Rain and wet soil can also darken the radar signal, so {js_num(metric['value'])} km² is the careful figure.")
        elif last and last["value"] > 1.1 * metric["value"]:
            out.append(f"The burned area kept growing: {km_fmt(last['value'])} by {format_date_short(last['date'])}.")
        out.append("Fire strips the leaves and branches that bounce part of the radar signal back, so burned ground goes dark. "
                   "Radar sees through smoke and cloud, day or night, which a normal camera from space cannot.")
        return out

    water = s["change_type"] != "vegetation"
    what = "under open water" if water else "flooded under the plants"
    subject = "this area" if water else "the marsh here"
    how = ("Calm water is smooth, so it bounces the radar signal away and shows up dark." if water else
           "Water standing among plants makes a corner that sends the signal straight back, so it shows up very bright. "
           "A normal camera from space cannot see water hidden under plants.")
    if not first or not last or len(ser) < 2:
        return [f"{pct(metric['value'])} of the area is {what}.", how]

    span = f"{pct(first['value'])} of the area on {format_date_short(first['date'])} to {pct(last['value'])} on {format_date_short(last['date'])}"
    out = []
    if metric.get("direction") == "upward":
        out.append(f"More of {subject} is {what}. It grew from {span}.")
    elif metric.get("direction") == "downward":
        out.append(f"Less of {subject} is {what}. It fell from {span}.")
    else:
        out.append(f"The part of {subject} that is {what} stayed about the same, from {span}.")

    hi = max(ser, key=lambda p: p["value"])
    lo = min(ser, key=lambda p: p["value"])
    jump = {"from": ser[0], "to": ser[1], "d": 0}
    for i in range(1, len(ser)):
        d = abs(ser[i]["value"] - ser[i - 1]["value"])
        if d > jump["d"]:
            jump = {"from": ser[i - 1], "to": ser[i], "d": d}
    if abs(last["value"] - first["value"]) < 1:
        out.append(f"The readings moved between {pct(lo['value'])} and {pct(hi['value'])} from pass to pass, "
                   "so this net change is small and easy to mistake for normal wobble.")
    else:
        hi_index = ser.index(hi)
        if 2 <= hi_index <= len(ser) - 2:
            times = hi["value"] / max(first["value"], 0.1)
            out.append(f"It peaked at {pct(hi['value'])} on {format_date_short(hi['date'])}"
                       + (f", about {round(times)} times the {format_date_short(first['date'])} level" if times >= 1.5 else "")
                       + f", then fell back to {pct(last['value'])}.")
        if metric.get("direction") == "downward" and last["value"] < 0.6 * first["value"]:
            out.append(f"Only about {round(last['value'] / first['value'] * 100)}% of the {format_date_short(first['date'])} amount is left.")
        out.append(f"The biggest single change came between {format_date_short(jump['from']['date'])} and {format_date_short(jump['to']['date'])}, "
                   f"when it went from {pct(jump['from']['value'])} to {pct(jump['to']['value'])}.")
    out.append(f"NISAR looked {s['passes']} times from the same angle, so the passes can be compared. {how}")
    return out
