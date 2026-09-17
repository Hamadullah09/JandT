package com.warehouse.handheld.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warehouse.handheld.rfid.Blip
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * The radar face.
 *
 * A compass rose the operator stands at the centre of. Distance from the middle
 * is loudness, not metres — a UHF reader cannot measure range either, and
 * drawing a tag "four metres away" would be inventing a number. Close to the
 * edge means faint; at the middle means it is right here.
 *
 * Everything is drawn relative to the heading the handheld is on **now**, so a
 * blip stays put in the room while the face turns under it. That is what lets
 * somebody walk towards it.
 */
@Composable
fun RadarFace(
    blips: List<Blip>,
    heading: Float,
    modifier: Modifier = Modifier,
) {
    val measurer = rememberTextMeasurer()

    // Deliberately smaller than the screen is wide.
    //
    // A face that fills the width looks impressive and pushes the list of tags
    // off the bottom, and the list is where the operator presses "Got it". The
    // laundry handheld gives the face about a third of the screen for the same
    // reason - and the owner asked for more rows on the screen, so it is a
    // step smaller again.
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(max = 220.dp)
            .padding(4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(212.dp)) {
            val centre = Offset(size.width / 2f, size.height / 2f)
            val radius = min(size.width, size.height) / 2f - 24f

            drawCircle(RadarDeep, radius, centre)
            drawCircle(RadarMid, radius * 0.66f, centre)
            drawCircle(RadarMid, radius * 0.33f, centre)

            for (ring in listOf(1f, 0.66f, 0.33f)) {
                drawCircle(RadarGrid, radius * ring, centre, style = Stroke(width = 1.5f))
            }

            drawLine(RadarGrid, Offset(centre.x, centre.y - radius), Offset(centre.x, centre.y + radius), 1.5f)
            drawLine(RadarGrid, Offset(centre.x - radius, centre.y), Offset(centre.x + radius, centre.y), 1.5f)

            // The needle: which way the handheld is pointing. Always straight
            // up, because the face turns instead - the operator is the fixed
            // thing in their own view of the room.
            drawLine(
                NeedleInk,
                centre,
                Offset(centre.x, centre.y - radius),
                strokeWidth = 5f,
            )

            for ((label, degrees) in listOf("0" to 0f, "90" to 90f, "180" to 180f, "270" to 270f)) {
                val angle = Math.toRadians((degrees - 90f).toDouble())
                val at = Offset(
                    centre.x + (radius + 8f) * cos(angle).toFloat(),
                    centre.y + (radius + 8f) * sin(angle).toFloat(),
                )
                val laid = measurer.measure(label, TextStyle(color = LabelInk, fontSize = 13.sp))
                drawText(laid, topLeft = Offset(at.x - laid.size.width / 2f, at.y - laid.size.height / 2f))
            }

            for (blip in blips) {
                if (!blip.heard) continue

                // Where it answered loudest, minus where we are pointing now.
                val relative = ((blip.bearing - heading) + 360f) % 360f
                val angle = Math.toRadians((relative - 90f).toDouble())

                // Loud means near the middle.
                val distance = radius * (1f - blip.strength / 100f).coerceIn(0.05f, 1f)
                val at = Offset(
                    centre.x + distance * cos(angle).toFloat(),
                    centre.y + distance * sin(angle).toFloat(),
                )

                val colour = when {
                    blip.strength >= 70 -> Good
                    blip.strength >= 35 -> Warn
                    else -> Cool
                }

                if (blip.settled) {
                    drawCircle(colour.copy(alpha = 0.30f), 26f, at)
                    drawCircle(colour, 13f, at)
                } else {
                    // Heard, but no one direction is winning yet - so say so
                    // rather than draw a dot somebody will walk towards. A ring
                    // at the right distance is still useful: it means "this far
                    // away, keep turning".
                    drawCircle(colour, radius * 0.92f, centre, style = Stroke(width = 2f))
                    drawCircle(colour.copy(alpha = 0.45f), 11f, at, style = Stroke(width = 3f))
                }

                val tail = blip.epc.takeLast(4)
                val laid = measurer.measure(tail, TextStyle(color = LabelInk, fontSize = 12.sp))
                drawText(laid, topLeft = Offset(at.x - laid.size.width / 2f, at.y + 16f))
            }

            drawCircle(NeedleInk, 15f, centre)
        }
    }
}

/*
 * A pale face, not the dark green one.
 *
 * A radar screen is dark by convention, and the convention comes from rooms
 * that are kept dark. This one is read under warehouse lights with the sun
 * coming through a roller door, where a dark face is a mirror - and it was the
 * only dark panel left in a light app, which made it look like a different
 * program had opened.
 *
 * The rings step inward so distance is still readable at a glance, and the
 * grid is ink at low opacity rather than white, so it sits on the pale ground
 * instead of disappearing into it.
 */
private val NeedleInk = Color(0xFF16181D)
private val LabelInk = Color(0xFF2F3846)

private val RadarDeep = Color(0xFFE8EFEA)
private val RadarMid = Color(0xFFD6E5DC)
private val RadarGrid = Color(0x33143B28)
