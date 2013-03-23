(function($,window,document,$window,$document,app){

    window.settings = {

        controls: {
            showOfflineContacts: $('#showOfflineContacts'),
            anchorToScreen: $("#anchorToScreen"),
            anchorCorner: $("#anchorCorner")
        },

        /* Public Functions */

        /* Private Functions */
        _init: function(){

            /* GUI event listeners */

            // Show offline contacts
            if(app.options.showOfflineContacts) settings.controls.showOfflineContacts.attr('checked', 'checked');
            settings.controls.showOfflineContacts.on('change', settings._toggleShowOfflineContacts);

            // Anchor to screen
            if(app.options.anchorToScreen){
                settings.controls.anchorToScreen.attr('checked', 'checked');
            }else{
                settings.controls.anchorCorner.attr('disabled', 'disabled');
            }
            settings.controls.anchorToScreen.on('change', settings._toggleAnchorToScreen);

            // Anchor corner
            if(app.options.anchorCorner){
                settings.controls.anchorCorner.children('[value='+app.options.anchorCorner+']').attr('selected', 'selected');
            }
            settings.controls.anchorCorner.children('.dropdown-menu').on('click', 'a', settings._changeAnchorCorner);
        },

        _toggleShowOfflineContacts: function(){
            app.options.showOfflineContacts = $(this).prop('checked');
            app._drawRoster();
            app._saveOptions();
        },

        _toggleAnchorToScreen: function(){
            var checked = $(this).prop('checked');
            app.options.anchorToScreen = checked;
            if(checked){
                settings.controls.anchorCorner.removeAttr('disabled');
            }else{
                settings.controls.anchorCorner.attr('disabled', 'disabled');
            }
            app._saveOptions();
        },

        _changeAnchorCorner: function(e){
            e.preventDefault();
            app.options.anchorCorner = $(this).attr('data-corner');
            settings.controls.anchorCorner.children('.dropdown-toggle').children('.value').text($(this).text());
            app._saveOptions();
        }
    };

    $document.ready(settings._init);

})(jQuery,
    window,
    document,
    jQuery(window),
    jQuery(document),
    window.opener.app);