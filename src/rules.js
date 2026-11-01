// Business rules in one place. Change a number here and the whole system follows.
export const RULES = Object.freeze({
  // Devices
  onlineWindowSeconds: 120, // no contact for this long -> shown as offline
  maxPointsPerUpload: 500,
  maxRoutePointsShown: 5000,
  maxRouteDays: 31,

  // Sites and check-ins
  defaultSiteRadiusM: 100, // a check-in this close to its site counts as "verified"
  minSiteRadiusM: 20,
  maxSiteRadiusM: 2000,
  siteMatchRadiusM: 50, // importing a site with the same name within this distance reuses the old one
  visitAccuracyM: 50, // a check-in needs a GPS fix at least this precise, or it is flagged
  maxPhotoBytes: 600_000,

  // Review flags
  trackWindowSeconds: 600, // look for tracking points this long before and after a check-in
  trackMatchRadiusM: 250, // ...and expect at least one within this distance of it
  maxTravelSpeedKmh: 120, // faster than this between two check-ins is not possible by road
  minTravelDistanceM: 300, // ignore GPS jitter over short distances
  clockSkewSeconds: 120, // phone clock ahead of the server by more than this is flagged
});
