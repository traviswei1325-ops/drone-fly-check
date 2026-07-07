/*
 * Coordinate parser for the drone fly-check tool.
 * Accepts: Google Maps URLs, decimal degrees, DMS, degree + decimal minutes.
 * Returns {lat, lng, format} on success, {error, message} on failure.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CoordParser = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  var TAIWAN = { latMin: 20, latMax: 27, lngMin: 117, lngMax: 123.5 };

  function inRange(lat, lng) {
    return Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  }

  function looksLikeTaiwanSwapped(a, b) {
    // a,b given as (lat,lng) candidates; true if they only make sense swapped
    var asIs =
      a >= TAIWAN.latMin && a <= TAIWAN.latMax &&
      b >= TAIWAN.lngMin && b <= TAIWAN.lngMax;
    var swapped =
      b >= TAIWAN.latMin && b <= TAIWAN.latMax &&
      a >= TAIWAN.lngMin && a <= TAIWAN.lngMax;
    return !asIs && swapped;
  }

  function finish(lat, lng, format) {
    if (!inRange(lat, lng)) {
      if (inRange(lng, lat)) {
        var t = lat; lat = lng; lng = t;
      } else {
        return { error: "out_of_range", message: "Coordinates out of range (lat ±90, lng ±180)." };
      }
    } else if (looksLikeTaiwanSwapped(lat, lng)) {
      var t2 = lat; lat = lng; lng = t2;
    }
    return { lat: round(lat), lng: round(lng), format: format };
  }

  function round(x) {
    return Math.round(x * 1e6) / 1e6;
  }

  var SHORT_LINK = /(?:^|\/\/)(?:maps\.app\.goo\.gl|goo\.gl)\//i;

  function parseUrl(text) {
    if (SHORT_LINK.test(text)) {
      return {
        error: "short_link",
        message: "That's a shortened link, which can't be expanded here. Open it in your browser, then copy the full URL from the address bar (it contains @lat,lng)."
      };
    }
    var url;
    try {
      url = decodeURIComponent(text);
    } catch (e) {
      url = text;
    }

    // Order matters: !3d/!4d is the actual pin; @lat,lng is just the viewport center.
    var m = url.match(/!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
    if (m) return finish(parseFloat(m[1]), parseFloat(m[2]), "Google Maps link (place pin)");

    m = url.match(/[?&](?:q|ll|query|center|destination)=(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
    if (m) return finish(parseFloat(m[1]), parseFloat(m[2]), "Google Maps link (query)");

    m = url.match(/\/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
    if (m) return finish(parseFloat(m[1]), parseFloat(m[2]), "Google Maps link (map center)");

    return { error: "url_no_coords", message: "Couldn't find coordinates in that URL." };
  }

  // One DMS component: 25°02'00.5"N — also tolerates fancy quote characters.
  var DMS_RE = /(\d{1,3})\s*[°º]\s*(\d{1,2}(?:\.\d+)?)(?:\s*['′’]\s*(\d{1,2}(?:\.\d+)?)\s*["″”]?)?\s*([NSEW])?/gi;
  // Degrees + decimal minutes without symbols: "25 02.123N"
  var DDM_RE = /(\d{1,3})\s+(\d{1,2}\.\d+)\s*([NSEW])/gi;
  // Plain decimal, optional hemisphere letter: "25.0330N" or "-121.5"
  var DEC_RE = /(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NSEW])?/gi;

  function applyHemisphere(value, hem) {
    if (!hem) return { value: value, axis: null };
    hem = hem.toUpperCase();
    var negative = hem === "S" || hem === "W";
    return {
      value: negative ? -Math.abs(value) : Math.abs(value),
      axis: hem === "N" || hem === "S" ? "lat" : "lng"
    };
  }

  function pairUp(components, format) {
    if (components.length !== 2) return null;
    var lat = null, lng = null, unlabeled = [];
    for (var i = 0; i < components.length; i++) {
      var c = components[i];
      if (c.axis === "lat") lat = c.value;
      else if (c.axis === "lng") lng = c.value;
      else unlabeled.push(c.value);
    }
    if (lat !== null && lng !== null) return finish(lat, lng, format);
    if (lat === null && lng === null) return finish(unlabeled[0], unlabeled[1], format);
    // One labeled, one not
    if (lat !== null) return finish(lat, unlabeled[0], format);
    return finish(unlabeled[0], lng, format);
  }

  function collect(re, text, toDecimal) {
    re.lastIndex = 0;
    var out = [], m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].trim() === "") { re.lastIndex++; continue; }
      out.push(toDecimal(m));
    }
    return out;
  }

  function parse(text) {
    if (text == null) return { error: "empty", message: "Nothing to parse." };
    text = String(text).trim();
    if (!text) return { error: "empty", message: "Nothing to parse." };

    if (/https?:\/\//i.test(text) || SHORT_LINK.test(text)) {
      return parseUrl(text);
    }

    // DMS (needs the ° symbol)
    if (/[°º]/.test(text)) {
      var dms = collect(DMS_RE, text, function (m) {
        var deg = parseFloat(m[1]);
        var min = m[2] ? parseFloat(m[2]) : 0;
        var sec = m[3] ? parseFloat(m[3]) : 0;
        var val = deg + min / 60 + sec / 3600;
        var h = applyHemisphere(val, m[4]);
        return h;
      });
      if (dms.length === 2) {
        var r = pairUp(dms, "DMS");
        if (r) return r;
      }
    }

    // Degrees + decimal minutes with hemisphere letters
    var ddm = collect(DDM_RE, text, function (m) {
      var val = parseFloat(m[1]) + parseFloat(m[2]) / 60;
      return applyHemisphere(val, m[3]);
    });
    if (ddm.length === 2) {
      var r2 = pairUp(ddm, "Degrees + decimal minutes");
      if (r2) return r2;
    }

    // Plain decimal pair
    var dec = collect(DEC_RE, text, function (m) {
      return applyHemisphere(parseFloat(m[1]), m[2]);
    });
    if (dec.length === 2) {
      var r3 = pairUp(dec, "Decimal degrees");
      if (r3) return r3;
    }

    return {
      error: "unrecognized",
      message: "Couldn't recognize that format. Try \"25.0330, 121.5654\", DMS like 25°02'00\"N 121°33'55\"E, or a full Google Maps URL."
    };
  }

  return { parse: parse };
});
