/**
 * Time formatting for anything an organiser copies out of the portal.
 *
 * `toLocaleTimeString("en-IN", { hour12: true })` renders the meridiem in
 * lowercase ("06:00 pm"), which reads as sloppy in a WhatsApp message pasted
 * into a group. There is no Intl option to control its case, so it is fixed
 * after the fact.
 */

/** "06:00 pm" → "06:00 PM". Handles the narrow no-break space some ICU builds emit. */
export const upperMeridiem = (s: string): string =>
  s.replace(/([   ]?)(am|pm)\b/gi, (_m, space, mer) => `${space}${mer.toUpperCase()}`);

/** Kickoff time in IST, e.g. "06:00 PM". */
export const formatIstTime = (
  value: string | number | Date,
  opts: Intl.DateTimeFormatOptions = {},
): string =>
  upperMeridiem(
    new Date(value).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      ...opts,
    }),
  );

/** Long date in IST, e.g. "Tuesday, 4 August 2026". */
export const formatIstLongDate = (value: string | number | Date): string =>
  new Date(value).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** Sign-off on shared messages. */
export const KASAKAI_SIGNOFF = "- Team KasaKai";
