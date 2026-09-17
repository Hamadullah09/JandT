# How to use it

A short guide. Two things to learn: the **website** on the office PC, and the
**C72 scanner** you carry on the floor.

---

## The idea in one minute

Every garment gets its own tag. Not "a tag for navy medium" — **one tag for one
garment**. That is the whole trick.

Because of it the system can tell you:

- exactly how many navy mediums are in room B2, without anybody counting
- which shop a particular garment was sent to
- and, when something comes back, whether it is really the one you sent

Stores buy from you in bulk — a size run at a time, not one piece. So stock is
counted in the dozens and hundreds, and the screens are built for that.

---

## Signing in

Open the website on the office PC. Sign in.

```
admin / admin123
```

**Change that password.** Go to *My account* and set a real one. It is printed
in the setup notes, so anybody who reads them can get in.

On the C72, open the **Warehouse** app. Same username and password.

The same sign-in opens the J&T portal - it is in the menu, under *Courier* - and
signing out of one signs you out of both.

On a phone or a tablet the menu is behind the **☰** button at the top left; the
screens are the same ones.

---

## The jobs

| Job | Where you start | Where you finish |
|---|---|---|
| Stock arrives | Website | C72 |
| A store orders | Website | C72 |
| Something comes back | Website | C72 |
| A garment is lost | Website | C72 |

The pattern is the same throughout: **the office says what should happen, the
scanner says what actually happened.**

> **One screen has been taken off the C72** at your request: *Move stock*. It
> still exists in the software and can be put back in a minute.

---

## 1. Stock arrives

**On the website** — *Book in stock* → *New intake*.

Say what came and how many. For example:

- Shalwar Kameez, Navy, Medium — **50**
- Shalwar Kameez, Navy, Large — **50**

Choose the room it is going into. Press *Start tagging*.

**On the C72** — open *Book stock in*. Your delivery is in the list. Open it.

Pick the line you are working on. Stick a tag on a garment, pull the trigger,
and the counter goes down: 50, 49, 48…

When the line hits zero the reader **stops** with a double beep, and the
screen says what is next — for example *Beige · S done. Next: Beige · L,
7 to tag.* Put the finished pile aside, bring the next one, and press the
trigger (or *Start Beige · L* on the screen): it carries on with that line.
It never moves on by itself, because the next line is a different pile.

A garment that already has a tag is refused once and then left alone, so a
finished pile lying next to the reader does not keep beeping.

On the website the same happens: a full line shows *Start …* for the next one.

> **The count is a limit.** If you try to tag a 51st garment onto a line of 50,
> it refuses. That is deliberate — it means a bad scan cannot invent stock that
> is not there.

When the whole delivery is tagged, press *Finish this intake*.

---

## 2. A store orders

**On the website** — *Orders* → *New order*.

Put in the shop's name and address, what they want and how many, and whether
they have **already paid** or it is **cash on delivery**.

*Import orders* has been taken off the website at your request, so orders are
typed in here. The importer itself still exists behind the scenes and the page
can be put back if a spreadsheet ever turns up.

**On the C72** — open *Pick an order*. Choose the order.

Now just scan garments. You do **not** have to say which line each one is for —
the scanner works it out from the tag.

- Right garment → **green**, and the count goes down
- Wrong garment → **red**, and it tells you why

> **You cannot over-pick.** Point it at a rail of fifty navy mediums for an
> order that wants three and it takes three, then refuses the rest: *not wanted
> on this order, or every one of them has already been picked.* The count on the
> order is a limit, the same way the count on an intake is.

When the last garment is scanned the order **goes out by itself**: a double
beep, the reader stops, and the screen says *Sent out*. There is no button to
press, and nothing to mark as delivered on the website afterwards — an order
is either *To pick* or *Shipped*. It is one-way; after that only a return
brings a garment back.

An order made only of dropship garments has nothing to scan, so it waits under
*To pick* on the website (marked *To send*) until somebody opens it and presses
*Send it out*.

From that moment each of those garments knows which shop it went to, which is
what makes a return checkable later.

---

## 3. Something comes back

**On the website** — open the order, press *Start a return*.

**On the C72** — open *Take a return*. Choose it. Scan whatever the shop sent
back. Each garment gets one of four answers:

| What it says | What it means |
|---|---|
| **Correct garment** | Yes, this went out on this order |
| **Another order** | It is ours — but it went to somebody else. It names who |
| **Never sent out** | Ours, but it never left the building |
| **Not our tag** | We have never seen this tag |

Every scan is kept, including the bad ones. A tag from a different order is
**evidence**, not a mistake to throw away.

> **Nothing moves yet.** No stock goes back, no money is refunded. You can scan,
> think again, and remove a scan without having changed anything.

**Back on the website**, when the desk is happy: press *Close and refund*. Only
now does stock go back up and the refund come off the order.

---

## 4. A garment is lost

**On the website** — *Find a garment*. Type a tag code, a product code, or an
order number. Press *Send to the handhelds*.

**On the C72** — open *Find a garment*. There are two ways to hunt.

**Track — use this one to actually find something.** Tap a garment on the list.
You get a big number and a bar that fills from 0 to 100 as you close in. Press
the trigger and walk. The caption under the bar says **measured by the reader**,
which means the number is the scanner's own, not a guess — at arm's length from
the tag it reads in the nineties. *Skip* moves to the next one on the list.

**Radar** — everything on the list at once, drawn around you. Press the trigger
and **turn on the spot**. Garments appear as blips in whatever direction they
answered loudest; the closer to the middle, the louder. Then walk that way.

> The radar is for *which way*, not for *how far*. It is a rougher instrument
> than Track and it is meant to be: a UHF reader cannot measure direction at
> all, it only knows how loudly a tag answered, so the direction is worked out
> by remembering which way you were pointing each time one shouted. That is why
> the face is empty until you turn, and why a blip you have not pinned down yet
> is drawn as a **hollow ring** instead of a solid dot — the ring means "it is
> about this far away, keep turning."

Use the radar to work out which end of the room, then press **Radar → Track** on
that garment to walk in on it.

Press **Got it** when you have it. It drops off everybody else's scanner, so two
people never hunt the same thing.

---

## Which product is this? Search by name or by photo

**On the website** — *Products*. Type a name, a code or a colour. Each product
shows its photo, every colour and size, and how many are on a shelf. *Find*
beside a colour and size sends the handhelds after one of them.

No name to type — a customer sent a picture of a dress? Press **Search by
photo** and choose the picture, or just **paste a screenshot** (Ctrl+V) or drop
the photo onto the page. The products that look most like it come up, closest
first:

- **Best match** — the first one is well ahead of the rest. That is the dress.
- **Closest** — several look alike (the same design in another colour, say).
  Check the pictures and pick.

**On the C72** — *Search products*. Type, or press **Take photo** and photograph
the garment (or **Gallery** for a picture saved on the handheld). *Tap to find*
on a colour and size starts the hunt straight away.

> A product can only be found by photo once it **has** a photo. Add them on
> the product's page: *Add photos*. The more angles, the better it recognises
> a photo taken differently.

---

## 5. Moving stock around

**Not on the C72 at the moment** — taken off at your request.

Until it goes back, correct a garment's room on the website: *All garments* →
find it → open it → set the room. Every correction is written into its history,
same as a scan would have been.

---

## The trigger

**Press once to start. Press again to stop.**

You do not hold it down. While it is scanning the bar at the bottom says
*Reading*.

On the **Track** screen it also beeps while it hunts — faster the closer you
get, like a metal detector, and it buzzes in your hand in the last foot or so.
That is so you can walk with the scanner pointed at the rail instead of at the
screen. Silence means nothing is answering yet. Pressing *Skip* moves to the
next garment **without** stopping the hunt, so you do not have to reach for the
trigger again.

There is nowhere to type a tag code by hand — the scanner does it.

---

## What the colours mean

| Colour | Meaning |
|---|---|
| **Green** | Worked |
| **Red** | Refused, and it says why — read it |
| **Amber** | Careful — something is unfinished |

**Notifications** on the website lists every colour and size with **fewer than
10** on the shelves, in red, and the number beside the tab says how many. `None
left` means it is gone. The front page shows the lowest few under **Running low**.

Ten is the standard warning level. You can change it per colour and size under
*Products* (**Edit** beside it) if a line sells faster or slower; `0` switches the
warning off.

Long lists on the website show **10 at a time**: use **Next ›** and **‹ Previous**
under the list.

---

## When something goes wrong

**The scanner says it cannot reach the server.**
Nearly always one of two things, in this order:

1. **The two black windows are closed.** Everything lives on the office PC. If
   they are shut, no scanner can work. Double-click **START.cmd**.
2. **The PC's address has changed.** It is not fixed. A different Wi-Fi, or the
   router restarting after a power cut, gives the PC a new number, and every
   handheld is still looking for the old one. Nothing on the PC looks wrong,
   which is what makes this one confusing.

For the second, the scanner can now sort itself out. On the sign-in screen tap
the address at the bottom, then **Find the warehouse PC** — or, if you are
already signed in, *Settings* → **Find it for me**. It asks every machine on the
Wi-Fi which one is the warehouse server, and saves the answer. A few seconds, no
typing.

If it says nothing answered, go to the office PC and double-click
**ADDRESS.cmd**. It shows the address to use right now *and* tells you whether
the system is running — which is the other half of the problem, because from the
scanner a stopped system and a wrong address look exactly the same.

Both must be on the same Wi-Fi, and their addresses should start the same way —
`192.168.1.` something on both, for example.

**The trigger does nothing.**
Check *Settings* on the C72. Under *The reader* it should say
**Chainway UHF — found and open**. If it says something else, close the app
fully and open it again — another app may be holding the reader.

**It is not picking up tags at the back of a deep shelf.**
*Settings* → raise the power. Lower it again when you are picking tags from the
next aisle by mistake.

**A garment is in the wrong place on the system.**
*All garments* → find it → open it. You can correct its room and state, and
every correction is written into its history.

**I made a mistake tagging.**
On the C72 the intake screen has *Undo that scan* right after each one.

---

## Starting and stopping

Start: double-click **START.cmd**. Two black windows open — leave them alone.
It prints the address for the handhelds at the end; **ADDRESS.cmd** shows it
again any time.

Stop: close those two windows when you finish for the day.

Everything is stored on the office PC. If it is off, the scanners cannot work.
