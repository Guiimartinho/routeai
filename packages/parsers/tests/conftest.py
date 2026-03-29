"""Shared test fixtures for routeai_parsers tests."""

from __future__ import annotations

import pytest


MINIMAL_PCB = """\
(kicad_pcb (version 20231014) (generator "test")
  (general (thickness 1.6) (legacy_teardrops no))
  (layers
    (0 "F.Cu" signal)
    (31 "B.Cu" signal)
    (36 "B.SilkS" user "B.Silkscreen")
    (37 "F.SilkS" user "F.Silkscreen")
    (44 "Edge.Cuts" user)
  )
  (setup
    (pad_to_mask_clearance 0.05)
    (aux_axis_origin 0 0)
  )
  (net 0 "")
  (net 1 "GND")
  (net 2 "VCC")
  (net_class "Default" "default net class"
    (clearance 0.15)
    (trace_width 0.25)
    (via_dia 0.6)
    (via_drill 0.3)
    (uvia_dia 0.3)
    (uvia_drill 0.1)
  )
  (footprint "Resistor_SMD:R_0402_1005Metric"
    (at 100 100)
    (layer "F.Cu")
    (fp_text reference "R1" (at 0 -1.2) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (fp_text value "10k" (at 0 1.2) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -0.5 0) (size 0.6 0.5) (layers "F.Cu" "F.Paste" "F.Mask") (net 2 "VCC"))
    (pad "2" smd rect (at 0.5 0) (size 0.6 0.5) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "GND"))
  )
  (segment (start 99.5 100) (end 95 100) (width 0.25) (layer "F.Cu") (net 2))
  (via (at 95 100) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 2))
  (gr_line (start 80 80) (end 120 80) (layer "Edge.Cuts") (width 0.05))
  (gr_line (start 120 80) (end 120 120) (layer "Edge.Cuts") (width 0.05))
  (gr_line (start 120 120) (end 80 120) (layer "Edge.Cuts") (width 0.05))
  (gr_line (start 80 120) (end 80 80) (layer "Edge.Cuts") (width 0.05))
)
"""

MINIMAL_SCH = """\
(kicad_sch (version 20231120) (generator "test")
  (uuid "00000000-0000-0000-0000-000000000001")
  (paper "A4")
  (title_block
    (title "Test Schematic")
    (date "2024-01-01")
    (rev "1.0")
    (company "RouteAI")
  )
  (lib_symbols
    (symbol "Device:R" (pin_numbers hide) (pin_names hide)
      (symbol "R_0_1"
        (pin passive line (at 0 1.27 270) (length 1.27) (name "~" (effects (font (size 0 0)))) (number "1" (effects (font (size 0 0)))))
        (pin passive line (at 0 -1.27 90) (length 1.27) (name "~" (effects (font (size 0 0)))) (number "2" (effects (font (size 0 0)))))
      )
    )
  )
  (symbol (lib_id "Device:R") (at 100 100 0) (unit 1)
    (uuid "00000000-0000-0000-0000-000000000010")
    (property "Reference" "R1" (at 102 99 0) (effects (font (size 1.27 1.27))))
    (property "Value" "10k" (at 102 101 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0402_1005Metric" (at 100 100 0) (effects (font (size 1.27 1.27)) hide))
    (pin "1" (uuid "00000000-0000-0000-0000-000000000011"))
    (pin "2" (uuid "00000000-0000-0000-0000-000000000012"))
  )
  (wire (pts (xy 100 98.73) (xy 100 95))
    (uuid "00000000-0000-0000-0000-000000000020")
  )
  (label "VCC" (at 100 95 0) (effects (font (size 1.27 1.27)))
    (uuid "00000000-0000-0000-0000-000000000030")
  )
)
"""


@pytest.fixture
def minimal_pcb_text() -> str:
    return MINIMAL_PCB


@pytest.fixture
def minimal_sch_text() -> str:
    return MINIMAL_SCH
