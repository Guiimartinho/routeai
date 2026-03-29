package handlers

import (
	"archive/zip"
	"bytes"
	"testing"
)

func TestDetectFormat_KiCad(t *testing.T) {
	buf := createZipWith(t, "test.kicad_pcb", "(kicad_pcb)")
	format := detectFormat(buf.Bytes(), int64(buf.Len()))
	if format != "kicad" {
		t.Errorf("expected kicad, got %s", format)
	}
}

func TestDetectFormat_KiCadSch(t *testing.T) {
	buf := createZipWith(t, "test.kicad_sch", "(kicad_sch)")
	format := detectFormat(buf.Bytes(), int64(buf.Len()))
	if format != "kicad" {
		t.Errorf("expected kicad, got %s", format)
	}
}

func TestDetectFormat_Eagle(t *testing.T) {
	buf := createZipWith(t, "test.brd", "<eagle>")
	format := detectFormat(buf.Bytes(), int64(buf.Len()))
	if format != "eagle" {
		t.Errorf("expected eagle, got %s", format)
	}
}

func TestDetectFormat_Altium(t *testing.T) {
	buf := createZipWith(t, "test.pcbdoc", "binary")
	format := detectFormat(buf.Bytes(), int64(buf.Len()))
	if format != "altium" {
		t.Errorf("expected altium, got %s", format)
	}
}

func TestDetectFormat_Gerber(t *testing.T) {
	buf := createZipWith(t, "top.gtl", "G04*\nD10*")
	format := detectFormat(buf.Bytes(), int64(buf.Len()))
	if format != "gerber" {
		t.Errorf("expected gerber, got %s", format)
	}
}

func TestDetectFormat_Unknown(t *testing.T) {
	buf := createZipWith(t, "readme.txt", "Hello world")
	format := detectFormat(buf.Bytes(), int64(buf.Len()))
	if format != "unknown" {
		t.Errorf("expected unknown, got %s", format)
	}
}

func TestDetectFormat_InvalidZip(t *testing.T) {
	data := []byte("this is not a zip file")
	format := detectFormat(data, int64(len(data)))
	if format != "unknown" {
		t.Errorf("expected unknown for invalid zip, got %s", format)
	}
}

func TestDetectFormat_EmptyZip(t *testing.T) {
	buf := &bytes.Buffer{}
	w := zip.NewWriter(buf)
	w.Close()
	format := detectFormat(buf.Bytes(), int64(buf.Len()))
	if format != "unknown" {
		t.Errorf("expected unknown for empty zip, got %s", format)
	}
}

func TestDetectFormat_MultipleFiles(t *testing.T) {
	buf := &bytes.Buffer{}
	w := zip.NewWriter(buf)

	// Add a readme first, then a KiCad file.
	fw, _ := w.Create("README.md")
	fw.Write([]byte("# Project"))
	fw, _ = w.Create("board.kicad_pcb")
	fw.Write([]byte("(kicad_pcb)"))
	w.Close()

	format := detectFormat(buf.Bytes(), int64(buf.Len()))
	if format != "kicad" {
		t.Errorf("expected kicad from multi-file zip, got %s", format)
	}
}

// createZipWith creates a zip buffer containing a single file with the given name and content.
func createZipWith(t *testing.T, filename, content string) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	w := zip.NewWriter(buf)
	fw, err := w.Create(filename)
	if err != nil {
		t.Fatalf("failed to create zip entry: %v", err)
	}
	if _, err := fw.Write([]byte(content)); err != nil {
		t.Fatalf("failed to write zip entry: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("failed to close zip writer: %v", err)
	}
	return buf
}
