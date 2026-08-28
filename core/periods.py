"""Period definition and date helpers.

Single source of truth for "what period is this".

Conventions used across the whole application:
- "Esta semana" is the ISO week that starts on MONDAY at 00:00 (local time).
- Day boundaries are local midnight.
- All comparisons happen on naive local datetimes, matching how events are
  stored (local ISO strings).
"""
from datetime import date, datetime, time, timedelta

WEEKDAY_ISO = {"mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 7}
ISO_NAMES = {1: "L", 2: "M", 3: "X", 4: "J", 5: "V", 6: "S", 7: "D"}

# ---------------------------------------------------------------------------
# Basic building blocks
# ---------------------------------------------------------------------------

def parse_dt(value):
    """Parse a local ISO datetime/datetime-string into a datetime."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    text = str(value).strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        return datetime.strptime(text[:10], "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"Invalid datetime: {value!r}")


def to_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()


def start_of_week(d):
    """Monday 00:00 for the week containing day d."""
    d = to_date(d)
    return datetime.combine(d - timedelta(days=d.weekday()), time.min)


def add_days(dt, days):
    return dt + timedelta(days=days)


# ---------------------------------------------------------------------------
# Named periods
# ---------------------------------------------------------------------------

def period_today(now):
    start = datetime.combine(now.date(), time.min)
    return start, now


def period_this_week(now):
    start = start_of_week(now)
    return start, now


def period_previous_week(now):
    end = start_of_week(now)
    start = end - timedelta(days=7)
    return start, end


def period_this_month(now):
    start = datetime(now.year, now.month, 1)
    return start, now


def period_previous_month(now):
    first_this = datetime(now.year, now.month, 1)
    last_prev = first_this - timedelta(days=1)
    start = datetime(last_prev.year, last_prev.month, 1)
    return start, first_this


def period_this_year(now):
    start = datetime(now.year, 1, 1)
    return start, now


def period_last_days(now, days):
    start = now - timedelta(days=days)
    return start, now


def period_all(now):
    return datetime(1970, 1, 1), now


def period_custom(now, start_date, end_date):
    start = datetime.combine(to_date(start_date), time.min)
    end_dt = to_date(end_date)
    end = datetime.combine(end_dt, time.max)
    if end > now:
        end = now
    return start, end


def get_period(name, now, start_date=None, end_date=None):
    """Return (start, end) datetimes for a named period."""
    funcs = {
        "today": period_today,
        "this_week": period_this_week,
        "prev_week": period_previous_week,
        "this_month": period_this_month,
        "prev_month": period_previous_month,
        "this_year": period_this_year,
        "last7": lambda n: period_last_days(n, 7),
        "last30": lambda n: period_last_days(n, 30),
        "last90": lambda n: period_last_days(n, 90),
        "all": period_all,
        "custom": lambda n: period_custom(n, start_date, end_date),
    }
    return funcs[name](now)


# ---------------------------------------------------------------------------
# Week / month arithmetic for charts
# ---------------------------------------------------------------------------

def weeks_since(start_date, now):
    """Number of ISO weeks spanned between start_date and now (>= 1)."""
    start = start_of_week(start_date)
    days = (now - start).days
    return max(1, days // 7 + 1)


def weeks_elapsed(start_date, now):
    """Number of complete or partial weeks elapsed since start (>= 1)."""
    start = to_date(start_date)
    today = to_date(now)
    days = (today - start).days
    return max(1, days // 7 + 1)


def months_elapsed(start_date, now):
    start = to_date(start_date)
    today = to_date(now)
    months = (today.year - start.year) * 12 + (today.month - start.month)
    return max(1, months + 1)


def week_buckets(start_date, now):
    """Return list of (label, start_dt, end_dt) for each week bucket since start."""
    first_monday = start_of_week(start_date)
    buckets = []
    cursor = first_monday
    while cursor <= start_of_week(now):
        end = cursor + timedelta(days=7)
        label = cursor.strftime("%d/%m")
        buckets.append((label, cursor, end))
        cursor = end
    return buckets


def month_buckets(start_date, now):
    """Return list of (label, start_dt, end_dt) for each month bucket since start."""
    start = to_date(start_date)
    today = to_date(now)
    buckets = []
    y, m = start.year, start.month
    while (y, m) <= (today.year, today.month):
        begin = datetime(y, m, 1)
        if m == 12:
            end = datetime(y + 1, 1, 1)
        else:
            end = datetime(y, m + 1, 1)
        buckets.append((f"{y}-{m:02d}", begin, end))
        m += 1
        if m == 13:
            m = 1
            y += 1
    return buckets


def day_buckets(start_date, now, days=30):
    """Return list of (label, start_dt, end_dt) for each of the last N days."""
    buckets = []
    today = to_date(now)
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        begin = datetime.combine(d, time.min)
        buckets.append((d.strftime("%d/%m"), begin, begin + timedelta(days=1)))
    return buckets


def calendar_year_days(now):
    """Days of the current year as list of dates, grouped by ISO week."""
    year = now.year
    first = date(year, 1, 1)
    last = date(year, 12, 31)
    first_weekday = first.isoweekday()  # 1..7 (Mon..Sun)
    # Grid starts from the Monday on/before Jan 1.
    grid_start = first - timedelta(days=first_weekday - 1)
    days = []
    d = grid_start
    while d <= last:
        days.append(d)
        d += timedelta(days=1)
    return days


def previous_month_days(now, months_back=0):
    """All dates of a month (0 = current month, 1 = previous, ...)."""
    year = now.year
    month = now.month
    for _ in range(months_back):
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    if month == 12:
        next_month = (year + 1, 1)
    else:
        next_month = (year, month + 1)
    import calendar as _cal
    days_in_month = _cal.monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(*next_month) - timedelta(days=1)
    return [start + timedelta(days=i) for i in range(days_in_month)], start, end


def weekday_name(iso):
    return ISO_NAMES.get(iso, "?")


def iso_weekday(dt):
    """ISO weekday of a date (1=Monday .. 7=Sunday)."""
    return to_date(dt).isoweekday()


def next_weekday_at(now_dt, iso_weekday, hour, minute):
    """Next occurrence of a weekday at a given hour:minute, strictly after now_dt.

    If now_dt is that weekday and already at/past the time, the result is a week
    ahead. Returns a naive local datetime.
    """
    days_ahead = (iso_weekday - now_dt.isoweekday()) % 7
    if days_ahead == 0 and (now_dt.hour, now_dt.minute, now_dt.second) >= (hour, minute, 0):
        days_ahead = 7
    target = (now_dt + timedelta(days=days_ahead)).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    )
    return target