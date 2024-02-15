> :warning: **This project is in very early development stage!** I'm still actively working on adding more services & backup storages!


<img src="https://github.com/daanschenkel/DockGuard/blob/main/logo.png?raw=true" width="100" height="100" align="right" />

# DockGuard

The easiest way to backup your Docker containers.

## ???
Are you struggling with backing something up, a database, container, or whatever?
DockGuard is here for you! Simply run the command, enter in some basic data and get a neat export file!
Importing back to a container is something we plan on adding soon™

## Usage

You can go the fully guided route by running `npx dockguard` and following the prompts, or you can fully automate the process by adding environment variables.

### Fully Guided

```bash
npx dockguard
```

### Environment Variables

```bash
export CONTAINERNAME_USER=yourusername
export CONTAINERNAME_PASSWORD=yourpassword

npx dockguard --unattended
```

### Supported Environment Variables & Flags

#### Environment Variables

- `CONTAINERNAME_USER` - The username of the database running in docker container 'containername'

- `CONTAINERNAME_PASSWORD` - The password of the database running in docker container 'containername'

- `DOCKGUARD_DISABLE_AUTH` - Set to `true` to automatically temporarily disable authentication for the database running in docker container 'containername' (DANGEROUS FOR PRODUCTION)

#### Flags

- `--unattended` - Run DockGuard without any prompts
- `--verbose` - Show verbose output
