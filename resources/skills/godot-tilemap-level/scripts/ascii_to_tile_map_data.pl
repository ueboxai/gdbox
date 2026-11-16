#!/usr/bin/perl
# Turn an ASCII level layout into the `tile_map_data = PackedByteArray(...)` line
# of a Godot 4.3+ TileMapLayer, so the level is real scene data the user can
# open and keep painting in the editor (instead of cells set from code at runtime).
#
# Usage:
#   perl ascii_to_tile_map_data.pl LAYOUT_FILE CHAR=SOURCE:ATLAS_X:ATLAS_Y ...
#   perl ascii_to_tile_map_data.pl level1.txt G=0:0:0 D=0:1:0 P=0:2:0
#
# LAYOUT_FILE: one text row per tile row, one character per cell. Row 0 is the
#   top. "." and " " are empty cells. Every other character must be in the legend.
# Output (stdout): one line, paste it under the TileMapLayer node in the .tscn.
# Summary (stderr): cell count and layout size.
#
# Byte layout (Godot TileMapLayer data format 0): a little-endian uint16 format
# version (0), then 12 bytes per cell: int16 x, int16 y, uint16 source_id,
# uint16 atlas_x, uint16 atlas_y, uint16 alternative_tile (always 0 here).
use strict;
use warnings;

my ($file, @legend) = @ARGV;
die "usage: perl ascii_to_tile_map_data.pl LAYOUT_FILE CHAR=SOURCE:ATLAS_X:ATLAS_Y ...\n"
  unless defined $file && @legend;

my %tiles;
for my $entry (@legend) {
  my ($char, $spec) = split /=/, $entry, 2;
  die "legend entry '$entry' must look like G=0:1:0\n"
    unless defined $spec && length($char) == 1 && $spec =~ /^(\d+):(\d+):(\d+)$/;
  $tiles{$char} = [$1, $2, $3];
}

open my $fh, '<:encoding(UTF-8)', $file or die "cannot read $file: $!\n";
my @bytes = (0, 0);
my ($y, $cells, $width) = (0, 0, 0);
while (my $line = <$fh>) {
  $line =~ s/\r?\n\z//;
  my @chars = split //, $line;
  $width = @chars if @chars > $width;
  for my $x (0 .. $#chars) {
    my $c = $chars[$x];
    next if $c eq '.' || $c eq ' ';
    my $t = $tiles{$c}
      or die "row " . ($y + 1) . ", column " . ($x + 1) . ": '$c' is not in the legend\n";
    push @bytes, unpack('C*', pack('s<s<S<S<S<S<', $x, $y, @$t, 0));
    $cells++;
  }
  $y++;
}
close $fh;
die "$file has no painted cells\n" unless $cells;

print 'tile_map_data = PackedByteArray(' . join(', ', @bytes) . ")\n";
print STDERR "$cells cells, layout ${width}x$y tiles\n";
