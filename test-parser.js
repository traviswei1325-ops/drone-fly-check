const { parse } = require("./parser.js");

const cases = [
  // [input, expected lat, expected lng] or [input, "error:<code>"]
  ["25.0330, 121.5654", 25.033, 121.5654],
  ["25.0330 121.5654", 25.033, 121.5654],
  ["121.5654, 25.0330", 25.033, 121.5654], // swapped, Taiwan heuristic
  ["25.0330N, 121.5654E", 25.033, 121.5654],
  ["121.5654E 25.0330N", 25.033, 121.5654], // labeled, out of order
  ["25.0330°, 121.5654°", 25.033, 121.5654],
  ["-33.8688, 151.2093", -33.8688, 151.2093], // Sydney, no Taiwan swap
  ["33.8688S 151.2093E", -33.8688, 151.2093],
  ["25°02'00\"N 121°33'55\"E", 25.033333, 121.565278],
  ["25°02′00″N 121°33′55″E", 25.033333, 121.565278], // unicode quotes
  ["25°01.98' N, 121°33.92' E", 25.033, 121.565333],
  ["25 01.980N, 121 33.924E", 25.033, 121.5654], // iPhone compass style DDM
  ["https://www.google.com/maps/@25.0339,121.5645,17z", 25.0339, 121.5645],
  ["https://www.google.com/maps/place/Taipei+101/@25.0339,121.5622,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d25.033976!4d121.564472!16z", 25.033976, 121.564472],
  ["https://www.google.com/maps?q=25.0330,121.5654", 25.033, 121.5654],
  ["https://maps.google.com/?ll=25.0330,121.5654&z=15", 25.033, 121.5654],
  ["https://maps.app.goo.gl/AbCdEf123", "error:short_link"],
  ["hello world", "error:unrecognized"],
  ["", "error:empty"],
  ["95.0, 200.0", "error:out_of_range"],
];

let failed = 0;
for (const [input, expLat, expLng] of cases) {
  const r = parse(input);
  let ok;
  if (typeof expLat === "string") {
    ok = r.error === expLat.slice(6);
  } else {
    ok = r.lat !== undefined &&
      Math.abs(r.lat - expLat) < 1e-4 &&
      Math.abs(r.lng - expLng) < 1e-4;
  }
  if (!ok) {
    failed++;
    console.log(`FAIL  ${JSON.stringify(input)}\n  expected ${expLat},${expLng}  got ${JSON.stringify(r)}`);
  } else {
    console.log(`ok    ${JSON.stringify(input)} -> ${r.error ? r.error : r.lat + "," + r.lng + " (" + r.format + ")"}`);
  }
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
