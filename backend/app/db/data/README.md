# Reference data

## malaysia_postcodes.json

Every Malaysian postcode with its post-office town and state: 2,929 postcodes,
16 states. Used by `app/core/address.py` to fill in the city and state of a
receiver address and to catch a postcode that does not match them.

Source: `all.json` from <https://github.com/AsyrafHussin/malaysia-postcodes>,
unchanged. Licensed under the MIT License:

```
MIT License

Copyright (c) 2020-2025 Asyraf Hussin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`postcode_zone` (seeded from `app/db/postcodes.py`) is a different thing: it
is generated from state-wide number ranges for sortation and pricing, so its
states are right but its cities are only approximate.
