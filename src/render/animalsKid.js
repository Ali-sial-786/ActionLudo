// Cute, kid-friendly versions of the ten animals (Kids mode).
//
// Contract: buildKidAnimal(id, fallback) returns { model, parts, idle(t) } exactly like the
// realistic builders in animals.js, facing +z, standing on y = 0, about one board square long,
// and exposing the SAME named parts so shared animation code keeps working:
//   eagle:     body, head, jaw, wingL, wingR, tail, talons, setWings(spread, flap)
//   tiger:     body, head, jaw, legFL, legFR, legBL, legBR, tail, tail2
//   wolf/bear: body, head, jaw, legFL, legFR, legBL, legBR, tail
//   rhino:     body, head, legFL, legFR, legBL, legBR, tail
//   gorilla:   body, head, jaw, armL, armR, legL, legR
//   cobra:     body, neck[4], hood, head, jaw, tongue
//   shark:     water (+ userData.noGore), foam, body, jaw, fin, tail
//   scorpion:  body, legs[8], clawL, clawR, fingerL, fingerR, tail[5], stinger
//   crocodile: body, head, jaw, legs[4], tail[4]
//
// Placeholder until the cute models land: fall back to the realistic builder.
export function buildKidAnimal(id, fallback) {
  return fallback();
}
