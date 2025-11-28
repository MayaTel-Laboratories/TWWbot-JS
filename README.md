This is a fork of Jason Prado's [bsky-image-bot](https://github.com/jasonprado/bsky-image-bot).
The end result of this bot is available [here](https://bsky.app/profile/TWWbot.bsky.social).
It is also a ground-up reimagining of [the original TWWbot for twitter](https://github.com/MayaTelLabs/TWWbot-Python), now renamed TWWbot-Python. It shares 0 lines of code with the original, thanks to an excellent codebase from Jason Prado. They are obviously not cross-compatible in any way.

This fork differs significantly in how it functions, including stripping out the image resizing and date code, while conforming to very strict image name structuring and adding automatic resolution detection.

The instructions below **will not work**. You should probably not fork this. As always: no refunds.

**In accordance with the original repository, this is licensed under the traditional MIT license instead of the modified MayaTel Software License usually seen in my repositories.**

ORIGINAL DESCRIPTION:

# bsky-image-bot

This is a simple bot that posts an image to Bluesky on a cron job using GitHub Actions.

## How to use

1. Fork this repo
1. Put your images under `imagequeue/`. Only JPG and PNG images are supported by Bluesky. Commit and push.
1. Edit index.ts to customize parsing of your filenames into post text. Commit and push.
1. Generate an [app password](https://bsky.app/settings/app-passwords) for your Bluesky account.
1. Set Repository Secrets (`github.com/YOUR/REPO/settings/secrets/actions`) `BSKY_IDENTIFIER` and `BSKY_PASSWORD`.
1. Create a [fine-grained GitHub personal token](https://github.com/settings/tokens?type=beta). Give it read/write access to repository variables.
1. Add the token as a secret named `REPO_ACCESS_TOKEN`.
1. Execute the `post-next-image` action from the GitHub UI.
1. When successful, edit `post-next-image.yml` to enable the automated post.
