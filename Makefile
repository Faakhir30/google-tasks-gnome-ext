UUID := googletasks@local
SCHEMA := schemas/org.gnome.shell.extensions.local-google-tasks.gschema.xml

.PHONY: check install uninstall

check:
	gjs -m test/taskModel.test.js

schemas/gschemas.compiled: $(SCHEMA)
	glib-compile-schemas schemas

install: check schemas/gschemas.compiled
	rm -f $(UUID).zip
	zip -9r $(UUID).zip metadata.json extension.js prefs.js tasksManager.js taskModel.js stylesheet.css schemas LICENSE README.md
	gnome-extensions install --force $(UUID).zip
	# The running shell only scans extensions at login. Record the UUID so the
	# next session enables it even when `gnome-extensions enable` cannot see it yet.
	python3 -c "import ast,subprocess; key=('org.gnome.shell','enabled-extensions'); cur=ast.literal_eval(subprocess.check_output(['gsettings','get',*key],text=True)); uuid='$(UUID)'; cur=[u for u in cur if u!='googletasks@ztluwu.dev']; cur=cur if uuid in cur else cur+[uuid]; subprocess.check_call(['gsettings','set',*key,str(cur)])"
	-gnome-extensions enable $(UUID)

uninstall:
	gnome-extensions uninstall $(UUID)
