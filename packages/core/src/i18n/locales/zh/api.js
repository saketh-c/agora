/**
 * Text for API responses (packages/server): errors, rate limits, address lookups, and the template
 * answer for an agenda item. Every error response also carries a stable code, so the web app can
 * show its own dictionary text instead of this one.
 */
export default {
  rateLimited: 'Too many requests came from your network in the last minute. Everyone on the same Wi-Fi counts together, so try again in {n} seconds.',
  notFound: 'Not found',
  invalidJson: 'The request body is not valid JSON.',
  bodyTooLarge: 'The request is too large.',
  serverError: 'Something went wrong on the server. Try again in a moment.',
  invalidField: 'The field "{field}" must be text.',
  invalidBody: 'Send the request as a JSON object.',
  missingQuery: 'Type a ZIP code or an address to look up.',
  missingTitle: 'Send the title of the agenda item you want explained.',
  geoNotFound: "We couldn't find that place in Dallas-Fort Worth. Check the spelling, or try a ZIP code or your city's name.",
  geoOutside: '{place} is outside the Dallas-Fort Worth area that Agora covers. Pick one of the cities on the list instead.',
  geoOutsideZip: 'ZIP code {zip} is outside the Dallas-Fort Worth area that Agora covers. Pick one of the cities on the list instead.',
  geoBusy: 'Address lookup is busy right now. Try again in a few seconds.',
  geoUnavailable: "Address lookup isn't available right now. Pick your city from the list instead; distances will measure from its city hall.",
  explainOnAgenda: 'This item is on a city council agenda.',
  explainWeighIn: 'To weigh in, sign up for public comment before the meeting starts.',
};
