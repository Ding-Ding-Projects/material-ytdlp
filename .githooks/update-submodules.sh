#!/bin/sh
# Shared by post-merge and post-checkout.
#
# --init      picks up a submodule added since this checkout was made
# --remote    advances to the tracked branch's upstream tip, not the recorded
#             gitlink; this is the whole point
# --recursive covers nested submodules
#
# Never fail the surrounding git operation. A pull that succeeds and then dies
# in a hook looks like the pull failed, and the user is left unsure what landed.
if [ -n "$MATERIAL_YTDLP_SKIP_SUBMODULE_UPDATE" ]; then
  exit 0
fi

echo "Updating vendored dependencies to their upstream tips..."
if ! git submodule update --init --remote --recursive; then
  echo "warning: could not update one or more submodules. The checkout is fine;"
  echo "         run 'git submodule update --init --remote --recursive' when you"
  echo "         next have network access." >&2
fi
exit 0
